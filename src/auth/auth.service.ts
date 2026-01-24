import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto, ResendCodeDto } from './dto/verify-email.dto';
import { generateReferralCode, generateOTP } from '../common/utils/helpers';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) {}

  async register(registerDto: RegisterDto) {
    const {
      username,
      email,
      password,
      confirmPassword,
      referralCode,
      language,
    } = registerDto;

    // Validate passwords match
    if (password !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    // Check if username exists
    const existingUsername = await this.prisma.user.findUnique({
      where: { username },
    });
    if (existingUsername) {
      throw new ConflictException('Username already taken');
    }

    // Check if email exists
    const existingEmail = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingEmail) {
      throw new ConflictException('Email already registered');
    }

    // Validate referral code (mandatory)
    const referrer = await this.prisma.user.findUnique({
      where: { referralCode },
    });
    if (!referrer) {
      throw new BadRequestException('Invalid referral code');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate unique referral code for new user
    let newReferralCode = generateReferralCode();
    while (
      await this.prisma.user.findUnique({
        where: { referralCode: newReferralCode },
      })
    ) {
      newReferralCode = generateReferralCode();
    }

    // Create user
    const user = await this.prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        referralCode: newReferralCode,
        referredBy: referrer.id,
        language,
        status: 'PENDING',
      },
    });

    // Generate and send verification code
    await this.sendVerificationCode(user.id, email);

    return {
      message: 'Registration successful. Please verify your email.',
      userId: user.id,
    };
  }

  async login(loginDto: LoginDto) {
    const { username, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { wallet: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.emailVerified) {
      throw new UnauthorizedException('Please verify your email first');
    }

    if (user.status === 'SUSPENDED') {
      throw new UnauthorizedException('Account suspended');
    }

    const token = this.generateToken(user.id, user.email);

    return {
      access_token: token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        balance: user.balance,
        referralCode: user.referralCode,
        language: user.language,
        hasWallet: !!user.wallet,
      },
    };
  }

  async verifyEmail(verifyEmailDto: VerifyEmailDto) {
    const { email, code } = verifyEmailDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const verificationCode = await this.prisma.verificationCode.findFirst({
      where: {
        userId: user.id,
        code,
        type: 'EMAIL_VERIFY',
        used: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!verificationCode) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    // Mark code as used and verify user
    await this.prisma.$transaction([
      this.prisma.verificationCode.update({
        where: { id: verificationCode.id },
        data: { used: true },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true, status: 'ACTIVE' },
      }),
    ]);

    const token = this.generateToken(user.id, user.email);

    return {
      message: 'Email verified successfully',
      access_token: token,
    };
  }

  async resendCode(resendCodeDto: ResendCodeDto) {
    const { email } = resendCodeDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email already verified');
    }

    await this.sendVerificationCode(user.id, email);

    return {
      message: 'Verification code sent',
    };
  }

  private async sendVerificationCode(userId: string, email: string) {
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Invalidate previous codes
    await this.prisma.verificationCode.updateMany({
      where: { userId, type: 'EMAIL_VERIFY', used: false },
      data: { used: true },
    });

    // Create new code
    await this.prisma.verificationCode.create({
      data: {
        userId,
        code,
        type: 'EMAIL_VERIFY',
        expiresAt,
      },
    });

    // Send email
    await this.emailService.sendVerificationEmail(email, code);
  }

  private generateToken(userId: string, email: string): string {
    return this.jwtService.sign({
      sub: userId,
      email,
    });
  }
}
