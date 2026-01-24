import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../email/email.service';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashedPassword'),
  compare: jest.fn(),
}));

// Mock helpers
jest.mock('../common/utils/helpers', () => ({
  generateReferralCode: jest.fn(),
  generateOTP: jest.fn(),
}));

import { generateReferralCode, generateOTP } from '../common/utils/helpers';
const mockGenerateReferralCode = generateReferralCode as jest.Mock;
const mockGenerateOTP = generateOTP as jest.Mock;

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: PrismaService;
  let jwtService: JwtService;
  let emailService: EmailService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    verificationCode: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('test-jwt-token'),
  };

  const mockEmailService = {
    sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
    emailService = module.get<EmailService>(EmailService);

    // Reset all mocks (including mock implementations, not just call history)
    jest.resetAllMocks();

    // Re-setup default mock return values after reset
    mockJwtService.sign.mockReturnValue('test-jwt-token');
    mockEmailService.sendVerificationEmail.mockResolvedValue(undefined);
    mockGenerateReferralCode.mockReturnValue('TESTCODE');
    mockGenerateOTP.mockReturnValue('123456');
  });

  describe('register', () => {
    const registerDto = {
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123',
      confirmPassword: 'password123',
      referralCode: 'REFERRER',
      language: 'en',
    };

    it('should throw BadRequestException if passwords do not match', async () => {
      await expect(
        service.register({
          ...registerDto,
          confirmPassword: 'differentPassword',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if username already exists', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ id: '1', username: 'testuser' }) // username check
        .mockResolvedValueOnce(null); // email check

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce(null) // username check - returns null (username not taken)
        .mockResolvedValueOnce({ id: '1', email: 'test@example.com' }) // email check - returns user (email exists)
        .mockResolvedValueOnce(null); // referral check - won't be reached

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if referral code is invalid', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce(null) // username check
        .mockResolvedValueOnce(null) // email check
        .mockResolvedValueOnce(null); // referral code check

      await expect(service.register(registerDto)).rejects.toThrow(BadRequestException);
    });

    it('should successfully register a new user', async () => {
      const referrer = { id: 'referrer-id', referralCode: 'REFERRER' };
      const newUser = { id: 'new-user-id', username: 'testuser', email: 'test@example.com' };

      mockPrismaService.user.findUnique
        .mockResolvedValueOnce(null) // username check
        .mockResolvedValueOnce(null) // email check
        .mockResolvedValueOnce(referrer) // referral code check
        .mockResolvedValueOnce(null); // unique referral code check

      mockPrismaService.user.create.mockResolvedValue(newUser);
      mockPrismaService.verificationCode.updateMany.mockResolvedValue({ count: 0 });
      mockPrismaService.verificationCode.create.mockResolvedValue({});

      const result = await service.register(registerDto);

      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('userId', 'new-user-id');
      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalledWith('test@example.com', '123456');
    });
  });

  describe('login', () => {
    const loginDto = {
      username: 'testuser',
      password: 'password123',
    };

    it('should throw UnauthorizedException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password is invalid', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        username: 'testuser',
        password: 'hashedPassword',
        emailVerified: true,
        status: 'ACTIVE',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if email not verified', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        username: 'testuser',
        password: 'hashedPassword',
        emailVerified: false,
        status: 'ACTIVE',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if account is suspended', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        username: 'testuser',
        password: 'hashedPassword',
        emailVerified: true,
        status: 'SUSPENDED',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should return access_token and user on successful login', async () => {
      const user = {
        id: '1',
        username: 'testuser',
        email: 'test@example.com',
        password: 'hashedPassword',
        emailVerified: true,
        status: 'ACTIVE',
        balance: 100,
        referralCode: 'USERCODE',
        language: 'en',
        wallet: null,
      };
      mockPrismaService.user.findUnique.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(loginDto);

      expect(result).toHaveProperty('access_token', 'test-jwt-token');
      expect(result.user).toHaveProperty('id', '1');
      expect(result.user).toHaveProperty('username', 'testuser');
      expect(result.user).toHaveProperty('hasWallet', false);
    });
  });

  describe('verifyEmail', () => {
    const verifyEmailDto = {
      email: 'test@example.com',
      code: '123456',
    };

    it('should throw BadRequestException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.verifyEmail(verifyEmailDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if verification code is invalid', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: '1', email: 'test@example.com' });
      mockPrismaService.verificationCode.findFirst.mockResolvedValue(null);

      await expect(service.verifyEmail(verifyEmailDto)).rejects.toThrow(BadRequestException);
    });

    it('should verify email and return token on success', async () => {
      const user = { id: '1', email: 'test@example.com' };
      const verificationCode = { id: 'code-1', userId: '1', code: '123456' };

      mockPrismaService.user.findUnique.mockResolvedValue(user);
      mockPrismaService.verificationCode.findFirst.mockResolvedValue(verificationCode);
      mockPrismaService.$transaction.mockResolvedValue([]);

      const result = await service.verifyEmail(verifyEmailDto);

      expect(result).toHaveProperty('message', 'Email verified successfully');
      expect(result).toHaveProperty('access_token', 'test-jwt-token');
    });
  });

  describe('resendCode', () => {
    const resendCodeDto = { email: 'test@example.com' };

    it('should throw BadRequestException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.resendCode(resendCodeDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if email already verified', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@example.com',
        emailVerified: true,
      });

      await expect(service.resendCode(resendCodeDto)).rejects.toThrow(BadRequestException);
    });

    it('should resend verification code successfully', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@example.com',
        emailVerified: false,
      });
      mockPrismaService.verificationCode.updateMany.mockResolvedValue({ count: 0 });
      mockPrismaService.verificationCode.create.mockResolvedValue({});

      const result = await service.resendCode(resendCodeDto);

      expect(result).toHaveProperty('message', 'Verification code sent');
      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalled();
    });
  });
});
