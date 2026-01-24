import { Test, TestingModule } from '@nestjs/testing';
import { WithdrawalsService } from './withdrawals.service';
import { PrismaService } from '../prisma/prisma.service';
import { TatumService } from '../tatum/tatum.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import * as bcrypt from 'bcrypt';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

describe('WithdrawalsService', () => {
  let service: WithdrawalsService;
  let prismaService: PrismaService;
  let emailService: EmailService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    withdrawal: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockTatumService = {
    sendUsdt: jest.fn(),
  };

  const mockEmailService = {
    sendWithdrawalNotification: jest.fn().mockResolvedValue(undefined),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue: any) => {
      const config: Record<string, any> = {
        MIN_WITHDRAWAL: 5,
      };
      return config[key] ?? defaultValue;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WithdrawalsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: TatumService, useValue: mockTatumService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<WithdrawalsService>(WithdrawalsService);
    prismaService = module.get<PrismaService>(PrismaService);
    emailService = module.get<EmailService>(EmailService);

    jest.clearAllMocks();
  });

  describe('createWithdrawal', () => {
    const createWithdrawalDto = {
      amount: 100,
      network: 'BEP20' as const,
      pin: '1234',
    };

    beforeEach(() => {
      // Default: PIN verification passes
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    });

    it('should throw BadRequestException if amount below minimum', async () => {
      await expect(
        service.createWithdrawal('user-1', { amount: 2, network: 'BEP20' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.createWithdrawal('user-1', createWithdrawalDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if no wallet linked', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        balance: new Decimal(1000),
        withdrawalPin: 'hashedpin',
        wallet: null,
      });

      await expect(
        service.createWithdrawal('user-1', createWithdrawalDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if insufficient balance', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        balance: new Decimal(50),
        withdrawalPin: 'hashedpin',
        wallet: { address: '0x123' },
      });

      await expect(
        service.createWithdrawal('user-1', createWithdrawalDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create withdrawal with correct fees for BEP20', async () => {
      // BEP20: 3% + $2
      // 100 * 0.03 = 3 + 2 = $5 fee
      // Net: 100 - 5 = $95
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        balance: new Decimal(1000),
        withdrawalPin: 'hashedpin',
        wallet: { address: '0x123' },
      });
      mockPrismaService.$transaction.mockResolvedValue([
        {
          id: 'withdrawal-1',
          amount: new Decimal(100),
          fee: new Decimal(5),
          netAmount: new Decimal(95),
          network: 'BEP20',
          toAddress: '0x123',
          status: 'PENDING',
        },
      ]);

      const result = await service.createWithdrawal('user-1', createWithdrawalDto);

      expect(result).toHaveProperty('id', 'withdrawal-1');
      expect(result).toHaveProperty('status', 'PENDING');
      expect(Number(result.fee)).toBe(5);
      expect(Number(result.netAmount)).toBe(95);
    });

    it('should create withdrawal with correct fees for TRC20', async () => {
      // TRC20: 5% + $2
      // 100 * 0.05 = 5 + 2 = $7 fee
      // Net: 100 - 7 = $93
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        balance: new Decimal(1000),
        withdrawalPin: 'hashedpin',
        wallet: { address: 'T123' },
      });
      mockPrismaService.$transaction.mockResolvedValue([
        {
          id: 'withdrawal-1',
          amount: new Decimal(100),
          fee: new Decimal(7),
          netAmount: new Decimal(93),
          network: 'TRC20',
          toAddress: 'T123',
          status: 'PENDING',
        },
      ]);

      const result = await service.createWithdrawal('user-1', {
        amount: 100,
        network: 'TRC20',
        pin: '1234',
      });

      expect(Number(result.fee)).toBe(7);
      expect(Number(result.netAmount)).toBe(93);
    });

    it('should throw BadRequestException if net amount is zero or negative', async () => {
      // Override minimum withdrawal to allow testing very small amounts
      mockConfigService.get.mockImplementation((key: string, defaultValue: any) => {
        if (key === 'MIN_WITHDRAWAL') return 1; // Allow $1 minimum
        return defaultValue;
      });

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        balance: new Decimal(1000),
        withdrawalPin: 'hashedpin',
        wallet: { address: '0x123' },
      });

      // $2 withdrawal with BEP20 (3% + $2):
      // Fee = 2 * 0.03 + 2 = 0.06 + 2 = $2.06
      // Net = 2 - 2.06 = -$0.06 (negative!)
      await expect(
        service.createWithdrawal('user-1', { amount: 2, network: 'BEP20', pin: '1234' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getWithdrawalHistory', () => {
    it('should return user withdrawal history', async () => {
      const mockWithdrawals = [
        { id: 'w-1', amount: new Decimal(100), status: 'CONFIRMED' },
        { id: 'w-2', amount: new Decimal(200), status: 'PENDING' },
      ];

      mockPrismaService.withdrawal.findMany.mockResolvedValue(mockWithdrawals);

      const result = await service.getWithdrawalHistory('user-1');

      expect(result).toHaveLength(2);
      expect(mockPrismaService.withdrawal.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('processWithdrawal', () => {
    it('should throw NotFoundException if withdrawal not found', async () => {
      mockPrismaService.withdrawal.findUnique.mockResolvedValue(null);

      await expect(service.processWithdrawal('w-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if already processed', async () => {
      mockPrismaService.withdrawal.findUnique.mockResolvedValue({
        id: 'w-1',
        status: 'CONFIRMED',
      });

      await expect(service.processWithdrawal('w-1')).rejects.toThrow(BadRequestException);
    });

    it('should process withdrawal successfully', async () => {
      mockPrismaService.withdrawal.findUnique.mockResolvedValue({
        id: 'w-1',
        userId: 'user-1',
        amount: new Decimal(100),
        netAmount: new Decimal(95),
        toAddress: '0x123',
        status: 'PENDING',
        user: { email: 'test@example.com' },
      });
      mockPrismaService.$transaction.mockResolvedValue([]);

      const result = await service.processWithdrawal('w-1');

      expect(result).toHaveProperty('message', 'Withdrawal processed successfully');
      expect(result).toHaveProperty('txId');
      expect(mockEmailService.sendWithdrawalNotification).toHaveBeenCalledWith(
        'test@example.com',
        '95',
        'CONFIRMED',
      );
    });
  });

  describe('getPendingWithdrawals', () => {
    it('should return pending withdrawals for admin', async () => {
      const mockWithdrawals = [
        { id: 'w-1', status: 'PENDING', user: { username: 'user1' } },
      ];

      mockPrismaService.withdrawal.findMany.mockResolvedValue(mockWithdrawals);

      const result = await service.getPendingWithdrawals();

      expect(result).toHaveLength(1);
      expect(mockPrismaService.withdrawal.findMany).toHaveBeenCalledWith({
        where: { status: 'PENDING' },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('calculateFees', () => {
    it('should calculate BEP20 fees correctly', () => {
      // 3% + $2 fixed
      const result = service.calculateFees(100, 'BEP20');

      expect(result.fee).toBe(5); // 3 + 2
      expect(result.netAmount).toBe(95); // 100 - 5
    });

    it('should calculate TRC20 fees correctly', () => {
      // 5% + $2 fixed
      const result = service.calculateFees(100, 'TRC20');

      expect(result.fee).toBe(7); // 5 + 2
      expect(result.netAmount).toBe(93); // 100 - 7
    });

    it('should handle large amounts correctly', () => {
      const result = service.calculateFees(10000, 'BEP20');

      expect(result.fee).toBe(302); // 300 + 2
      expect(result.netAmount).toBe(9698); // 10000 - 302
    });
  });
});
