import { Test, TestingModule } from '@nestjs/testing';
import { ReferralsService } from './referrals.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('ReferralsService', () => {
  let service: ReferralsService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    transaction: {
      aggregate: jest.fn(),
    },
    teamBonus: {
      aggregate: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferralsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<ReferralsService>(ReferralsService);
    prismaService = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('getReferralCode', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getReferralCode('user-1')).rejects.toThrow(NotFoundException);
    });

    it('should return user referral code', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        referralCode: 'TESTCODE',
      });

      const result = await service.getReferralCode('user-1');

      expect(result).toEqual({ referralCode: 'TESTCODE' });
    });
  });

  describe('getReferrals', () => {
    it('should return list of direct referrals', async () => {
      const mockReferrals = [
        {
          id: 'ref-1',
          username: 'user1',
          createdAt: new Date(),
          totalDeposits: new Decimal(500),
          _count: { referrals: 2 },
        },
        {
          id: 'ref-2',
          username: 'user2',
          createdAt: new Date(),
          totalDeposits: new Decimal(1000),
          _count: { referrals: 5 },
        },
      ];

      mockPrismaService.user.findMany.mockResolvedValue(mockReferrals);

      const result = await service.getReferrals('user-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('username', 'user1');
      expect(result[0]).toHaveProperty('teamSize', 2);
      expect(result[1]).toHaveProperty('teamSize', 5);
    });

    it('should return empty array if no referrals', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await service.getReferrals('user-1');

      expect(result).toHaveLength(0);
    });
  });

  describe('getReferralStats', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getReferralStats('user-1')).rejects.toThrow(NotFoundException);
    });

    it('should return comprehensive referral statistics', async () => {
      const mockUser = {
        referralCode: 'TESTCODE',
        totalTeamEarnings: new Decimal(500),
        _count: { referrals: 5 },
      };

      const mockLevel1Referrals = [
        { id: 'ref-1', totalDeposits: new Decimal(1000), _count: { referrals: 2 } },
        { id: 'ref-2', totalDeposits: new Decimal(2000), _count: { referrals: 3 } },
      ];

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.user.findMany.mockResolvedValue(mockLevel1Referrals);
      mockPrismaService.user.count.mockResolvedValue(5); // Level 2 count
      mockPrismaService.transaction.aggregate.mockResolvedValue({
        _sum: { amount: new Decimal(200) },
      });
      mockPrismaService.teamBonus.aggregate.mockResolvedValue({
        _sum: { amount: new Decimal(300) },
      });

      const result = await service.getReferralStats('user-1');

      expect(result).toHaveProperty('referralCode', 'TESTCODE');
      expect(result).toHaveProperty('level1Count', 5);
      expect(result).toHaveProperty('level2Count', 5);
      expect(result).toHaveProperty('totalTeamSize', 10);
      expect(result).toHaveProperty('totalTeamDeposits', 3000);
      expect(result).toHaveProperty('totalReferralBonuses');
      expect(result).toHaveProperty('totalTeamCommissions');
    });
  });

  describe('getTeamTree', () => {
    it('should return hierarchical team tree', async () => {
      // Mock level 1 referrals
      mockPrismaService.user.findMany
        .mockResolvedValueOnce([
          { id: 'ref-1', username: 'user1', totalDeposits: new Decimal(100), createdAt: new Date() },
          { id: 'ref-2', username: 'user2', totalDeposits: new Decimal(200), createdAt: new Date() },
        ])
        // Mock level 2 referrals for ref-1
        .mockResolvedValueOnce([
          { id: 'ref-3', username: 'user3', totalDeposits: new Decimal(50), createdAt: new Date() },
        ])
        // Mock level 2 referrals for ref-2
        .mockResolvedValueOnce([])
        // Mock level 3 (should not be called with depth=2)
        .mockResolvedValueOnce([]);

      const result = await service.getTeamTree('user-1', 2);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('username', 'user1');
      expect(result[0]).toHaveProperty('level', 1);
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children[0]).toHaveProperty('username', 'user3');
      expect(result[0].children[0]).toHaveProperty('level', 2);
    });

    it('should return empty array for user with no referrals', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await service.getTeamTree('user-1');

      expect(result).toHaveLength(0);
    });

    it('should respect depth parameter', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([
        { id: 'ref-1', username: 'user1', totalDeposits: new Decimal(100), createdAt: new Date() },
      ]);

      const result = await service.getTeamTree('user-1', 1);

      expect(result).toHaveLength(1);
      expect(result[0].children).toHaveLength(0); // Should not fetch level 2
    });
  });
});
