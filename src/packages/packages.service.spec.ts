import { Test, TestingModule } from '@nestjs/testing';
import { PackagesService } from './packages.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('PackagesService', () => {
  let service: PackagesService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    package: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    investment: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PackagesService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<PackagesService>(PackagesService);
    prismaService = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all active packages', async () => {
      const mockPackages = [
        { id: '1', name: 'Bronze', durationDays: 30, dailyProfit: new Decimal(3.5), isActive: true },
        { id: '2', name: 'Silver', durationDays: 90, dailyProfit: new Decimal(4.0), isActive: true },
      ];

      mockPrismaService.package.findMany.mockResolvedValue(mockPackages);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(mockPrismaService.package.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { durationDays: 'asc' },
      });
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException if package not found', async () => {
      mockPrismaService.package.findUnique.mockResolvedValue(null);

      await expect(service.findOne('pkg-1')).rejects.toThrow(NotFoundException);
    });

    it('should return package if found', async () => {
      const mockPackage = { id: 'pkg-1', name: 'Bronze', durationDays: 30 };
      mockPrismaService.package.findUnique.mockResolvedValue(mockPackage);

      const result = await service.findOne('pkg-1');

      expect(result).toEqual(mockPackage);
    });
  });

  describe('invest', () => {
    const investDto = {
      packageId: 'pkg-1',
      amount: 500,
    };

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.invest('user-1', investDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if insufficient balance', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        balance: new Decimal(100),
      });

      await expect(service.invest('user-1', investDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if package not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        balance: new Decimal(1000),
      });
      mockPrismaService.package.findUnique.mockResolvedValue(null);

      await expect(service.invest('user-1', investDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if amount below minimum', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        balance: new Decimal(1000),
      });
      mockPrismaService.package.findUnique.mockResolvedValue({
        id: 'pkg-1',
        name: 'Bronze',
        isActive: true,
        minAmount: new Decimal(1000),
        maxAmount: new Decimal(10000),
        durationDays: 30,
        dailyProfit: new Decimal(3.5),
      });

      await expect(service.invest('user-1', investDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if amount above maximum', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        balance: new Decimal(100000),
      });
      mockPrismaService.package.findUnique.mockResolvedValue({
        id: 'pkg-1',
        name: 'Bronze',
        isActive: true,
        minAmount: new Decimal(100),
        maxAmount: new Decimal(1000),
        durationDays: 30,
        dailyProfit: new Decimal(3.5),
      });

      await expect(
        service.invest('user-1', { packageId: 'pkg-1', amount: 5000 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create investment successfully', async () => {
      const mockPackage = {
        id: 'pkg-1',
        name: 'Bronze',
        isActive: true,
        minAmount: new Decimal(100),
        maxAmount: new Decimal(10000),
        durationDays: 30,
        dailyProfit: new Decimal(3.5),
      };

      const mockInvestment = {
        id: 'inv-1',
        amount: new Decimal(500),
        dailyProfit: new Decimal(3.5),
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        balance: new Decimal(1000),
      });
      mockPrismaService.package.findUnique.mockResolvedValue(mockPackage);
      mockPrismaService.$transaction.mockResolvedValue([mockInvestment]);

      const result = await service.invest('user-1', investDto);

      expect(result).toHaveProperty('message', 'Investment created successfully');
      expect(result.investment).toHaveProperty('packageName', 'Bronze');
    });
  });

  describe('getUserInvestments', () => {
    it('should return all user investments', async () => {
      const mockInvestments = [
        { id: 'inv-1', status: 'ACTIVE', package: { name: 'Bronze' } },
        { id: 'inv-2', status: 'COMPLETED', package: { name: 'Silver' } },
      ];

      mockPrismaService.investment.findMany.mockResolvedValue(mockInvestments);

      const result = await service.getUserInvestments('user-1');

      expect(result).toHaveLength(2);
      expect(mockPrismaService.investment.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        include: { package: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getActiveInvestments', () => {
    it('should return only active investments', async () => {
      const mockInvestments = [
        { id: 'inv-1', status: 'ACTIVE', package: { name: 'Bronze' } },
      ];

      mockPrismaService.investment.findMany.mockResolvedValue(mockInvestments);

      const result = await service.getActiveInvestments('user-1');

      expect(result).toHaveLength(1);
      expect(mockPrismaService.investment.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: 'ACTIVE' },
        include: { package: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('seedPackages', () => {
    it('should seed default packages', async () => {
      mockPrismaService.package.upsert.mockResolvedValue({});

      const result = await service.seedPackages();

      expect(result).toHaveProperty('message', 'Packages seeded successfully');
      expect(mockPrismaService.package.upsert).toHaveBeenCalledTimes(3);
    });
  });
});
