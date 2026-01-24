import { Test, TestingModule } from '@nestjs/testing';
import { DepositsService } from './deposits.service';
import { PrismaService } from '../prisma/prisma.service';
import { TatumService } from '../tatum/tatum.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { WalletPoolService } from './wallet-pool.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('DepositsService', () => {
  let service: DepositsService;
  let prismaService: PrismaService;
  let walletPoolService: WalletPoolService;

  const mockPrismaService = {
    depositWallet: {
      findFirst: jest.fn(),
    },
    deposit: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockTatumService = {};

  const mockEmailService = {
    sendDepositConfirmation: jest.fn().mockResolvedValue(undefined),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue: any) => {
      const config: Record<string, any> = {
        MIN_DEPOSIT: 100,
        DEPOSIT_BONUS_PERCENT: 3,
        REFERRAL_BONUS_PERCENT: 7,
      };
      return config[key] ?? defaultValue;
    }),
  };

  const mockWalletPoolService = {
    getOrAssignWallet: jest.fn(),
    markWalletUsed: jest.fn(),
    getPoolStats: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepositsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: TatumService, useValue: mockTatumService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: WalletPoolService, useValue: mockWalletPoolService },
      ],
    }).compile();

    service = module.get<DepositsService>(DepositsService);
    prismaService = module.get<PrismaService>(PrismaService);
    walletPoolService = module.get<WalletPoolService>(WalletPoolService);

    jest.clearAllMocks();
  });

  describe('getDepositAddress', () => {
    it('should throw BadRequestException for invalid network', async () => {
      await expect(service.getDepositAddress('user-1', 'INVALID')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should return deposit address for BEP20', async () => {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      mockWalletPoolService.getOrAssignWallet.mockResolvedValue({
        address: '0x123',
        expiresAt,
        isNew: false,
      });

      const result = await service.getDepositAddress('user-1', 'BEP20');

      expect(result).toHaveProperty('address', '0x123');
      expect(result).toHaveProperty('network', 'BEP20');
      expect(result).toHaveProperty('minDeposit', 100);
      expect(result).toHaveProperty('depositBonus', 3);
      expect(result).toHaveProperty('isNewWallet', false);
    });

    it('should return deposit address for TRC20', async () => {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      mockWalletPoolService.getOrAssignWallet.mockResolvedValue({
        address: 'T123',
        expiresAt,
        isNew: true,
      });

      const result = await service.getDepositAddress('user-1', 'TRC20');

      expect(result).toHaveProperty('address', 'T123');
      expect(result).toHaveProperty('network', 'TRC20');
      expect(result).toHaveProperty('isNewWallet', true);
    });
  });

  describe('createDeposit', () => {
    const createDepositDto = {
      amount: 500,
      network: 'BEP20' as const,
    };

    it('should throw BadRequestException if amount below minimum', async () => {
      await expect(
        service.createDeposit('user-1', { amount: 50, network: 'BEP20' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if no active deposit address', async () => {
      mockPrismaService.depositWallet.findFirst.mockResolvedValue(null);

      await expect(service.createDeposit('user-1', createDepositDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should create deposit successfully', async () => {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      mockPrismaService.depositWallet.findFirst.mockResolvedValue({
        id: 'wallet-1',
        address: '0x123',
        expiresAt,
      });
      mockPrismaService.deposit.create.mockResolvedValue({
        id: 'deposit-1',
        amount: new Decimal(500),
        network: 'BEP20',
        depositAddress: '0x123',
        status: 'PENDING',
      });

      const result = await service.createDeposit('user-1', createDepositDto);

      expect(result).toHaveProperty('id', 'deposit-1');
      expect(result).toHaveProperty('amount', 500);
      expect(result).toHaveProperty('status', 'PENDING');
      expect(result).toHaveProperty('message');
    });
  });

  describe('confirmDeposit', () => {
    const txHash = '0xabc123';

    it('should throw NotFoundException if deposit not found', async () => {
      mockPrismaService.deposit.findUnique.mockResolvedValue(null);

      await expect(service.confirmDeposit('deposit-1', txHash)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if deposit already confirmed', async () => {
      mockPrismaService.deposit.findUnique.mockResolvedValue({
        id: 'deposit-1',
        status: 'CONFIRMED',
      });

      await expect(service.confirmDeposit('deposit-1', txHash)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should confirm deposit and apply bonuses', async () => {
      const mockDeposit = {
        id: 'deposit-1',
        userId: 'user-1',
        amount: new Decimal(1000),
        status: 'PENDING',
        depositWalletId: 'wallet-1',
        user: {
          id: 'user-1',
          email: 'test@example.com',
          referredBy: null,
        },
      };

      mockPrismaService.deposit.findUnique.mockResolvedValue(mockDeposit);
      mockPrismaService.$transaction.mockResolvedValue([]);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        referrer: null,
      });
      mockWalletPoolService.markWalletUsed.mockResolvedValue(undefined);

      const result = await service.confirmDeposit('deposit-1', txHash);

      expect(result).toHaveProperty('message', 'Deposit confirmed successfully');
      expect(mockEmailService.sendDepositConfirmation).toHaveBeenCalled();
    });
  });

  describe('getDepositHistory', () => {
    it('should return user deposit history', async () => {
      const mockDeposits = [
        { id: 'deposit-1', amount: new Decimal(100), status: 'CONFIRMED' },
        { id: 'deposit-2', amount: new Decimal(200), status: 'PENDING' },
      ];

      mockPrismaService.deposit.findMany.mockResolvedValue(mockDeposits);

      const result = await service.getDepositHistory('user-1');

      expect(result).toHaveLength(2);
      expect(mockPrismaService.deposit.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        select: expect.any(Object),
      });
    });
  });

  describe('getPendingDeposits', () => {
    it('should return pending deposits', async () => {
      const mockDeposits = [
        { id: 'deposit-1', status: 'PENDING', user: { username: 'user1' } },
      ];

      mockPrismaService.deposit.findMany.mockResolvedValue(mockDeposits);

      const result = await service.getPendingDeposits();

      expect(result).toHaveLength(1);
      expect(mockPrismaService.deposit.findMany).toHaveBeenCalledWith({
        where: { status: 'PENDING' },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('getPoolStats', () => {
    it('should return pool statistics', async () => {
      mockWalletPoolService.getPoolStats.mockResolvedValue({
        total: 10,
        available: 5,
        assigned: 5,
      });

      const result = await service.getPoolStats();

      expect(result).toHaveProperty('total', 10);
      expect(result).toHaveProperty('available', 5);
    });
  });

  describe('getActiveDepositSession', () => {
    it('should return null if no active session', async () => {
      mockPrismaService.depositWallet.findFirst.mockResolvedValue(null);

      const result = await service.getActiveDepositSession('user-1', 'BEP20');

      expect(result).toBeNull();
    });

    it('should return active session details', async () => {
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      mockPrismaService.depositWallet.findFirst.mockResolvedValue({
        address: '0x123',
        network: 'BEP20',
        expiresAt,
      });

      const result = await service.getActiveDepositSession('user-1', 'BEP20');

      expect(result).toHaveProperty('address', '0x123');
      expect(result).toHaveProperty('network', 'BEP20');
      expect(result).toHaveProperty('expiresIn');
    });
  });
});
