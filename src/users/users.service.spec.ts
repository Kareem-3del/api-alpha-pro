import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';
import { NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('UsersService', () => {
  let service: UsersService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('admin@example.com'),
  };

  const mockEmailService = {
    sendVerificationEmail: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prismaService = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('getProfile', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('user-id')).rejects.toThrow(NotFoundException);
    });

    it('should return user profile with correct data', async () => {
      const mockUser = {
        id: 'user-1',
        username: 'testuser',
        email: 'test@example.com',
        balance: new Decimal(1000),
        totalDeposits: new Decimal(500),
        totalWithdrawals: new Decimal(100),
        totalProfit: new Decimal(50),
        totalTeamEarnings: new Decimal(25),
        referralCode: 'TESTCODE',
        language: 'en',
        wallet: { id: 'wallet-1', address: '0x123' },
        createdAt: new Date(),
        _count: {
          referrals: 5,
          investments: 2,
        },
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getProfile('user-1');

      expect(result).toHaveProperty('id', 'user-1');
      expect(result).toHaveProperty('username', 'testuser');
      expect(result).toHaveProperty('hasWallet', true);
      expect(result).toHaveProperty('referralCount', 5);
      expect(result).toHaveProperty('activeInvestments', 2);
      expect(result).toHaveProperty('isAdmin', false);
    });

    it('should identify admin users correctly', async () => {
      const mockUser = {
        id: 'user-1',
        username: 'admin',
        email: 'admin@example.com',
        balance: new Decimal(0),
        totalDeposits: new Decimal(0),
        totalWithdrawals: new Decimal(0),
        totalProfit: new Decimal(0),
        totalTeamEarnings: new Decimal(0),
        referralCode: 'ADMIN',
        language: 'en',
        wallet: null,
        createdAt: new Date(),
        _count: {
          referrals: 0,
          investments: 0,
        },
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getProfile('user-1');

      expect(result).toHaveProperty('isAdmin', true);
    });
  });

  describe('getDashboard', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getDashboard('user-id')).rejects.toThrow(NotFoundException);
    });

    it('should return complete dashboard data', async () => {
      const mockUser = {
        id: 'user-1',
        balance: new Decimal(1000),
        totalDeposits: new Decimal(500),
        totalWithdrawals: new Decimal(100),
        totalProfit: new Decimal(50),
        totalTeamEarnings: new Decimal(25),
        referralCode: 'TESTCODE',
        wallet: { id: 'wallet-1' },
        investments: [
          {
            id: 'inv-1',
            amount: new Decimal(100),
            dailyProfit: new Decimal(3.5),
            totalProfit: new Decimal(10),
            startDate: new Date(),
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            package: { name: 'Bronze' },
          },
        ],
        transactions: [
          { id: 'tx-1', type: 'DEPOSIT', amount: new Decimal(100), createdAt: new Date() },
        ],
        _count: {
          referrals: 5,
        },
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getDashboard('user-1');

      expect(result).toHaveProperty('balance');
      expect(result).toHaveProperty('totalActiveInvestment', 100);
      expect(result).toHaveProperty('expectedDailyProfit', 3.5);
      expect(result).toHaveProperty('referralCode', 'TESTCODE');
      expect(result).toHaveProperty('referralCount', 5);
      expect(result).toHaveProperty('hasWallet', true);
      expect(result).toHaveProperty('currentWeeklySalary', 0);
      expect(result).toHaveProperty('activeInvestments');
      expect(result).toHaveProperty('recentTransactions');
    });

    it('should calculate weekly salary tier correctly', async () => {
      const mockUser = {
        id: 'user-1',
        balance: new Decimal(1000),
        totalDeposits: new Decimal(500),
        totalWithdrawals: new Decimal(100),
        totalProfit: new Decimal(50),
        totalTeamEarnings: new Decimal(25),
        referralCode: 'TESTCODE',
        wallet: null,
        investments: [],
        transactions: [],
        _count: { referrals: 15 },
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getDashboard('user-1');

      expect(result).toHaveProperty('currentWeeklySalary', 30);
      expect(result).toHaveProperty('nextTierReferrals', 25);
      expect(result).toHaveProperty('nextTierSalary', 50);
      expect(result).toHaveProperty('referralsNeeded', 10);
    });
  });

  describe('updateLanguage', () => {
    it('should update user language successfully', async () => {
      mockPrismaService.user.update.mockResolvedValue({ id: 'user-1', language: 'ar' });

      const result = await service.updateLanguage('user-1', 'ar');

      expect(result).toHaveProperty('message', 'Language updated successfully');
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { language: 'ar' },
      });
    });
  });
});
