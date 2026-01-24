import { Test, TestingModule } from '@nestjs/testing';
import { WalletService } from './wallet.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

jest.mock('../common/utils/helpers', () => ({
  generateOTP: jest.fn().mockReturnValue('123456'),
}));

describe('WalletService', () => {
  let service: WalletService;
  let prismaService: PrismaService;
  let emailService: EmailService;

  const mockPrismaService = {
    wallet: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    verificationCode: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    systemConfig: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockEmailService = {
    sendWalletVerificationEmail: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
    prismaService = module.get<PrismaService>(PrismaService);
    emailService = module.get<EmailService>(EmailService);

    jest.clearAllMocks();
  });

  describe('getWallet', () => {
    it('should return user wallet if exists', async () => {
      const mockWallet = { id: 'wallet-1', address: '0x123', network: 'BEP20' };
      mockPrismaService.wallet.findUnique.mockResolvedValue(mockWallet);

      const result = await service.getWallet('user-1');

      expect(result).toEqual(mockWallet);
    });

    it('should return null if no wallet exists', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(null);

      const result = await service.getWallet('user-1');

      expect(result).toBeNull();
    });
  });

  describe('requestLinkWallet', () => {
    const linkWalletDto = {
      address: '0x1234567890123456789012345678901234567890',
      network: 'BEP20' as const,
    };

    it('should throw ConflictException if wallet already linked', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue({ id: 'wallet-1' });

      await expect(service.requestLinkWallet('user-1', linkWalletDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.requestLinkWallet('user-1', linkWalletDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should send verification code successfully', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      mockPrismaService.verificationCode.updateMany.mockResolvedValue({ count: 0 });
      mockPrismaService.verificationCode.create.mockResolvedValue({});
      mockPrismaService.systemConfig.upsert.mockResolvedValue({});

      const result = await service.requestLinkWallet('user-1', linkWalletDto);

      expect(result).toHaveProperty('message', 'Verification code sent to your email');
      expect(mockEmailService.sendWalletVerificationEmail).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
      );
    });
  });

  describe('verifyAndLinkWallet', () => {
    const verifyDto = { code: '123456' };

    it('should throw BadRequestException if code invalid', async () => {
      mockPrismaService.verificationCode.findFirst.mockResolvedValue(null);

      await expect(service.verifyAndLinkWallet('user-1', verifyDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if no pending wallet', async () => {
      mockPrismaService.verificationCode.findFirst.mockResolvedValue({
        id: 'code-1',
        code: '123456',
      });
      mockPrismaService.systemConfig.findUnique.mockResolvedValue(null);

      await expect(service.verifyAndLinkWallet('user-1', verifyDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should link wallet successfully', async () => {
      mockPrismaService.verificationCode.findFirst.mockResolvedValue({
        id: 'code-1',
        code: '123456',
      });
      mockPrismaService.systemConfig.findUnique.mockResolvedValue({
        key: 'pending_wallet_user-1',
        value: JSON.stringify({ address: '0x123', network: 'BEP20' }),
      });
      mockPrismaService.$transaction.mockResolvedValue([]);

      const result = await service.verifyAndLinkWallet('user-1', verifyDto);

      expect(result).toHaveProperty('message', 'Wallet linked successfully');
    });
  });

  describe('requestChangeWallet', () => {
    const updateDto = {
      address: '0xnewaddress',
      network: 'TRC20' as const,
    };

    it('should throw NotFoundException if no wallet exists', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(null);

      await expect(service.requestChangeWallet('user-1', updateDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue({ id: 'wallet-1' });
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.requestChangeWallet('user-1', updateDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should send change verification code successfully', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue({ id: 'wallet-1' });
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      mockPrismaService.verificationCode.updateMany.mockResolvedValue({ count: 0 });
      mockPrismaService.verificationCode.create.mockResolvedValue({});
      mockPrismaService.systemConfig.upsert.mockResolvedValue({});

      const result = await service.requestChangeWallet('user-1', updateDto);

      expect(result).toHaveProperty('message', 'Verification code sent to your email');
    });
  });

  describe('verifyAndChangeWallet', () => {
    const verifyDto = { code: '123456' };

    it('should throw BadRequestException if code invalid', async () => {
      mockPrismaService.verificationCode.findFirst.mockResolvedValue(null);

      await expect(service.verifyAndChangeWallet('user-1', verifyDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if no pending change', async () => {
      mockPrismaService.verificationCode.findFirst.mockResolvedValue({
        id: 'code-1',
        code: '123456',
      });
      mockPrismaService.systemConfig.findUnique.mockResolvedValue(null);

      await expect(service.verifyAndChangeWallet('user-1', verifyDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should update wallet successfully', async () => {
      mockPrismaService.verificationCode.findFirst.mockResolvedValue({
        id: 'code-1',
        code: '123456',
      });
      mockPrismaService.systemConfig.findUnique.mockResolvedValue({
        key: 'pending_wallet_change_user-1',
        value: JSON.stringify({ address: '0xnew', network: 'TRC20' }),
      });
      mockPrismaService.$transaction.mockResolvedValue([]);

      const result = await service.verifyAndChangeWallet('user-1', verifyDto);

      expect(result).toHaveProperty('message', 'Wallet updated successfully');
    });
  });
});
