import { Test, TestingModule } from '@nestjs/testing';
import { TeamService } from './team.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('TeamService', () => {
  let service: TeamService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    teamBonus: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
    weeklySalary: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<TeamService>(TeamService);
    prismaService = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('getTeamEarnings', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getTeamEarnings('user-1')).rejects.toThrow(NotFoundException);
    });

    it('should return comprehensive team earnings', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        totalTeamEarnings: new Decimal(500),
      });

      mockPrismaService.teamBonus.aggregate
        .mockResolvedValueOnce({
          _sum: { amount: new Decimal(300) },
          _count: 15,
        })
        .mockResolvedValueOnce({
          _sum: { amount: new Decimal(100) },
          _count: 10,
        });

      mockPrismaService.weeklySalary.aggregate.mockResolvedValue({
        _sum: { amount: new Decimal(100) },
        _count: 4,
      });

      mockPrismaService.teamBonus.findMany.mockResolvedValue([
        { id: 'bonus-1', amount: new Decimal(10), level: 1, bonusDate: new Date() },
      ]);

      const result = await service.getTeamEarnings('user-1');

      expect(result).toHaveProperty('totalTeamEarnings');
      expect(result.level1).toHaveProperty('percentage', 10);
      expect(result.level2).toHaveProperty('percentage', 5);
      expect(result.weeklySalary).toHaveProperty('weeksReceived', 4);
      expect(result).toHaveProperty('recentBonuses');
    });

    it('should handle user with no earnings', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        totalTeamEarnings: new Decimal(0),
      });

      mockPrismaService.teamBonus.aggregate.mockResolvedValue({
        _sum: { amount: null },
        _count: 0,
      });

      mockPrismaService.weeklySalary.aggregate.mockResolvedValue({
        _sum: { amount: null },
        _count: 0,
      });

      mockPrismaService.teamBonus.findMany.mockResolvedValue([]);

      const result = await service.getTeamEarnings('user-1');

      expect(result.level1.totalEarnings).toBe(0);
      expect(result.level2.totalEarnings).toBe(0);
      expect(result.weeklySalary.totalEarnings).toBe(0);
    });
  });

  describe('getTeamLevels', () => {
    it('should return team levels with members', async () => {
      const mockLevel1 = [
        {
          id: 'ref-1',
          username: 'user1',
          totalDeposits: new Decimal(1000),
          createdAt: new Date(),
          _count: { investments: 2 },
        },
        {
          id: 'ref-2',
          username: 'user2',
          totalDeposits: new Decimal(2000),
          createdAt: new Date(),
          _count: { investments: 1 },
        },
      ];

      const mockLevel2 = [
        {
          id: 'ref-3',
          username: 'user3',
          totalDeposits: new Decimal(500),
          createdAt: new Date(),
          referredBy: 'ref-1',
          _count: { investments: 0 },
        },
      ];

      mockPrismaService.user.findMany
        .mockResolvedValueOnce(mockLevel1)
        .mockResolvedValueOnce(mockLevel2);

      const result = await service.getTeamLevels('user-1');

      expect(result.level1.count).toBe(2);
      expect(result.level2.count).toBe(1);
      expect(result.totalTeamSize).toBe(3);
      expect(result.totalTeamDeposits).toBe(3500);
    });

    it('should handle user with no team', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await service.getTeamLevels('user-1');

      expect(result.level1.count).toBe(0);
      expect(result.level2.count).toBe(0);
      expect(result.totalTeamSize).toBe(0);
      expect(result.totalTeamDeposits).toBe(0);
    });
  });

  describe('getWeeklySalaryInfo', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getWeeklySalaryInfo('user-1')).rejects.toThrow(NotFoundException);
    });

    it('should return correct next tier for 0-9 referrals', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        _count: { referrals: 5 },
      });
      mockPrismaService.weeklySalary.findMany.mockResolvedValue([]);

      const result = await service.getWeeklySalaryInfo('user-1');

      expect(result.currentReferrals).toBe(5);
      expect(result.currentWeeklySalary).toBe(0);
      expect(result.nextTier).toEqual({ referrals: 10, salary: 30 });
      expect(result.referralsNeeded).toBe(5);
    });

    it('should return correct next tier for 10-24 referrals', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        _count: { referrals: 15 },
      });
      mockPrismaService.weeklySalary.findMany.mockResolvedValue([]);

      const result = await service.getWeeklySalaryInfo('user-1');

      expect(result.currentWeeklySalary).toBe(30);
      expect(result.nextTier).toEqual({ referrals: 25, salary: 50 });
      expect(result.referralsNeeded).toBe(10);
    });

    it('should return correct next tier for 25-49 referrals', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        _count: { referrals: 35 },
      });
      mockPrismaService.weeklySalary.findMany.mockResolvedValue([]);

      const result = await service.getWeeklySalaryInfo('user-1');

      expect(result.currentWeeklySalary).toBe(50);
      expect(result.nextTier).toEqual({ referrals: 50, salary: 75 });
      expect(result.referralsNeeded).toBe(15);
    });

    it('should return correct next tier for 50-99 referrals', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        _count: { referrals: 75 },
      });
      mockPrismaService.weeklySalary.findMany.mockResolvedValue([]);

      const result = await service.getWeeklySalaryInfo('user-1');

      expect(result.currentWeeklySalary).toBe(75);
      expect(result.nextTier).toEqual({ referrals: 100, salary: 120 });
      expect(result.referralsNeeded).toBe(25);
    });

    it('should return null next tier for 100+ referrals', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        _count: { referrals: 150 },
      });
      mockPrismaService.weeklySalary.findMany.mockResolvedValue([]);

      const result = await service.getWeeklySalaryInfo('user-1');

      expect(result.currentWeeklySalary).toBe(120);
      expect(result.nextTier).toBeNull();
      expect(result.referralsNeeded).toBe(0);
    });

    it('should include salary tiers and history', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        _count: { referrals: 20 },
      });

      const mockHistory = [
        { id: 'salary-1', amount: new Decimal(30), weekStart: new Date() },
      ];
      mockPrismaService.weeklySalary.findMany.mockResolvedValue(mockHistory);

      const result = await service.getWeeklySalaryInfo('user-1');

      expect(result.salaryTiers).toHaveLength(4);
      expect(result.history).toEqual(mockHistory);
    });
  });
});
