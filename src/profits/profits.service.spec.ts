import { Test, TestingModule } from '@nestjs/testing';
import { ProfitsService } from './profits.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';

describe('ProfitsService', () => {
  let service: ProfitsService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    investment: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    profitRecord: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    teamBonus: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    weeklySalary: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue: any) => {
      const config: Record<string, any> = {
        TEAM_LEVEL1_PERCENT: 10,
        TEAM_LEVEL2_PERCENT: 5,
      };
      return config[key] ?? defaultValue;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfitsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<ProfitsService>(ProfitsService);
    prismaService = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('distributeDailyProfits', () => {
    it('should distribute profits to all active investments', async () => {
      const mockInvestments = [
        {
          id: 'inv-1',
          userId: 'user-1',
          amount: new Decimal(1000),
          dailyProfit: new Decimal(3.5),
          user: { id: 'user-1', referredBy: null },
        },
        {
          id: 'inv-2',
          userId: 'user-2',
          amount: new Decimal(2000),
          dailyProfit: new Decimal(4.0),
          user: { id: 'user-2', referredBy: 'user-1' },
        },
      ];

      mockPrismaService.investment.findMany
        .mockResolvedValueOnce(mockInvestments) // Active investments
        .mockResolvedValueOnce([]); // Matured investments

      mockPrismaService.$transaction.mockResolvedValue([]);
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await service.distributeDailyProfits();

      expect(mockPrismaService.investment.findMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          endDate: { gt: expect.any(Date) },
        },
        include: { user: true },
      });
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(2);
    });

    it('should process team commissions for referred users', async () => {
      const mockInvestment = {
        id: 'inv-1',
        userId: 'user-2',
        amount: new Decimal(1000),
        dailyProfit: new Decimal(3.5),
        user: { id: 'user-2', referredBy: 'user-1' },
      };

      mockPrismaService.investment.findMany
        .mockResolvedValueOnce([mockInvestment])
        .mockResolvedValueOnce([]);

      mockPrismaService.$transaction.mockResolvedValue([]);

      // Mock referrer chain
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-2',
        referrer: {
          id: 'user-1',
          referrer: null, // No grandparent
        },
      });

      await service.distributeDailyProfits();

      // Should have called $transaction for: 1 investment profit + 1 team commission + complete matured
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should complete matured investments', async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

      mockPrismaService.investment.findMany
        .mockResolvedValueOnce([]) // No active investments
        .mockResolvedValueOnce([
          { id: 'inv-1', status: 'ACTIVE', endDate: pastDate },
        ]); // Matured investments

      mockPrismaService.investment.update.mockResolvedValue({});

      await service.distributeDailyProfits();

      expect(mockPrismaService.investment.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'COMPLETED' },
      });
    });
  });

  describe('distributeWeeklySalary', () => {
    it('should distribute salary based on referral count', async () => {
      const mockUsers = [
        { id: 'user-1', status: 'ACTIVE', _count: { referrals: 5 } },  // $0
        { id: 'user-2', status: 'ACTIVE', _count: { referrals: 15 } }, // $30
        { id: 'user-3', status: 'ACTIVE', _count: { referrals: 30 } }, // $50
        { id: 'user-4', status: 'ACTIVE', _count: { referrals: 75 } }, // $75
        { id: 'user-5', status: 'ACTIVE', _count: { referrals: 150 } }, // $120
      ];

      mockPrismaService.user.findMany.mockResolvedValue(mockUsers);
      mockPrismaService.$transaction.mockResolvedValue([]);

      await service.distributeWeeklySalary();

      // Should call $transaction for users with 10+ referrals (4 users)
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(4);
    });

    it('should not distribute salary to users with less than 10 referrals', async () => {
      const mockUsers = [
        { id: 'user-1', status: 'ACTIVE', _count: { referrals: 5 } },
        { id: 'user-2', status: 'ACTIVE', _count: { referrals: 9 } },
      ];

      mockPrismaService.user.findMany.mockResolvedValue(mockUsers);

      await service.distributeWeeklySalary();

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('triggerDailyProfits', () => {
    it('should call distributeDailyProfits and return message', async () => {
      mockPrismaService.investment.findMany.mockResolvedValue([]);

      const result = await service.triggerDailyProfits();

      expect(result).toEqual({ message: 'Daily profits distributed' });
    });
  });

  describe('triggerWeeklySalary', () => {
    it('should call distributeWeeklySalary and return message', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await service.triggerWeeklySalary();

      expect(result).toEqual({ message: 'Weekly salary distributed' });
    });
  });

  describe('getProfitHistory', () => {
    it('should return user profit history', async () => {
      const mockProfits = [
        {
          id: 'profit-1',
          amount: new Decimal(35),
          profitDate: new Date(),
          investment: { package: { name: 'Bronze' } },
        },
      ];

      mockPrismaService.profitRecord.findMany.mockResolvedValue(mockProfits);

      const result = await service.getProfitHistory('user-1');

      expect(result).toHaveLength(1);
      expect(mockPrismaService.profitRecord.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        include: { investment: { include: { package: true } } },
        orderBy: { profitDate: 'desc' },
      });
    });
  });

  describe('getTeamBonusHistory', () => {
    it('should return team bonus history', async () => {
      const mockBonuses = [
        { id: 'bonus-1', amount: new Decimal(10), level: 1, bonusDate: new Date() },
        { id: 'bonus-2', amount: new Decimal(5), level: 2, bonusDate: new Date() },
      ];

      mockPrismaService.teamBonus.findMany.mockResolvedValue(mockBonuses);

      const result = await service.getTeamBonusHistory('user-1');

      expect(result).toHaveLength(2);
      expect(mockPrismaService.teamBonus.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { bonusDate: 'desc' },
      });
    });
  });

  describe('getWeeklySalaryHistory', () => {
    it('should return weekly salary history', async () => {
      const mockSalaries = [
        {
          id: 'salary-1',
          amount: new Decimal(30),
          referralCount: 15,
          weekStart: new Date(),
          weekEnd: new Date(),
        },
      ];

      mockPrismaService.weeklySalary.findMany.mockResolvedValue(mockSalaries);

      const result = await service.getWeeklySalaryHistory('user-1');

      expect(result).toHaveLength(1);
      expect(mockPrismaService.weeklySalary.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { weekStart: 'desc' },
      });
    });
  });
});
