import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { getWeeklySalaryAmount, generateOTP } from '../common/utils/helpers';

@Injectable()
export class UsersService {
  private readonly adminEmails: string[];

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {
    // Admin emails from env, comma-separated
    const adminEmailsStr = this.configService.get<string>('ADMIN_EMAILS', '');
    this.adminEmails = adminEmailsStr
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: true,
        _count: {
          select: {
            referrals: {
              where: {
                emailVerified: true,
                totalDeposits: { gt: 0 },
              },
            },
            investments: { where: { status: 'ACTIVE' } },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isAdmin = this.adminEmails.includes(user.email.toLowerCase());

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      balance: user.balance,
      totalDeposits: user.totalDeposits,
      totalWithdrawals: user.totalWithdrawals,
      totalProfit: user.totalProfit,
      totalTeamEarnings: user.totalTeamEarnings,
      referralCode: user.referralCode,
      language: user.language,
      hasWallet: !!user.wallet,
      hasPin: !!user.withdrawalPin,
      wallet: user.wallet,
      referralCount: user._count.referrals,
      activeInvestments: user._count.investments,
      isAdmin,
      createdAt: user.createdAt,
    };
  }

  async getDashboard(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: true,
        referrals: {
          where: {
            emailVerified: true,
            totalDeposits: { gt: 0 },
          },
          select: { id: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get active investments
    const activeInvestments = await this.prisma.investment.findMany({
      where: {
        userId,
        status: 'ACTIVE',
      },
      include: {
        package: true,
      },
      orderBy: { startDate: 'desc' },
    });

    // Calculate totals
    const referralCount = user.referrals.length;
    let totalActiveInvestment = 0;
    let expectedDailyProfit = 0;

    for (const inv of activeInvestments) {
      totalActiveInvestment += Number(inv.amount);
      expectedDailyProfit += (Number(inv.amount) * Number(inv.dailyProfit)) / 100;
    }

    const currentWeeklySalary = getWeeklySalaryAmount(referralCount);

    // Calculate next tier
    let nextTierReferrals: number | null = null;
    let nextTierSalary: number | null = null;
    let referralsNeeded = 0;

    if (referralCount < 10) {
      nextTierReferrals = 10;
      nextTierSalary = 30;
      referralsNeeded = 10 - referralCount;
    } else if (referralCount < 25) {
      nextTierReferrals = 25;
      nextTierSalary = 50;
      referralsNeeded = 25 - referralCount;
    } else if (referralCount < 50) {
      nextTierReferrals = 50;
      nextTierSalary = 75;
      referralsNeeded = 50 - referralCount;
    } else if (referralCount < 100) {
      nextTierReferrals = 100;
      nextTierSalary = 120;
      referralsNeeded = 100 - referralCount;
    }

    // Get recent transactions
    const recentTransactions = await this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Format active investments for response
    const formattedInvestments = activeInvestments.map((inv) => ({
      id: inv.id,
      packageName: inv.package.name,
      amount: inv.amount,
      dailyProfit: inv.dailyProfit,
      totalProfit: inv.totalProfit,
      status: inv.status,
      startDate: inv.startDate,
      endDate: inv.endDate,
      daysRemaining: Math.max(0, Math.ceil((inv.endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
    }));

    return {
      balance: user.balance,
      totalDeposits: user.totalDeposits,
      totalWithdrawals: user.totalWithdrawals,
      totalProfit: user.totalProfit,
      totalTeamEarnings: user.totalTeamEarnings,
      totalActiveInvestment,
      expectedDailyProfit,
      referralCode: user.referralCode,
      referralCount,
      hasWallet: !!user.wallet,
      hasPin: !!user.withdrawalPin,
      currentWeeklySalary,
      nextTierReferrals,
      nextTierSalary,
      referralsNeeded,
      activeInvestments: formattedInvestments,
      recentTransactions,
      // Investment summary
      investmentSummary: {
        totalInvestments: activeInvestments.length,
        totalActiveAmount: totalActiveInvestment,
        expectedDailyProfit,
        expectedMonthlyProfit: expectedDailyProfit * 30,
      },
    };
  }

  async updateLanguage(userId: string, language: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { language },
    });

    return { message: 'Language updated successfully' };
  }

  // ========== PIN Management ==========

  async hasWithdrawalPin(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { withdrawalPin: true },
    });
    return !!user?.withdrawalPin;
  }

  async requestPinOtp(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Invalidate previous PIN OTP codes
    await this.prisma.verificationCode.updateMany({
      where: { userId, type: 'PIN_SETUP', used: false },
      data: { used: true },
    });

    // Create new code
    await this.prisma.verificationCode.create({
      data: {
        userId,
        code,
        type: 'PIN_SETUP',
        expiresAt,
      },
    });

    // Send email
    await this.emailService.sendPinOtpEmail(user.email, code);

    return { message: 'OTP sent to your email' };
  }

  async setWithdrawalPin(userId: string, pin: string, otp: string) {
    // Validate PIN format (4-6 digits)
    if (!/^\d{4,6}$/.test(pin)) {
      throw new BadRequestException('PIN must be 4-6 digits');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Verify OTP
    const verificationCode = await this.prisma.verificationCode.findFirst({
      where: {
        userId,
        code: otp,
        type: 'PIN_SETUP',
        used: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!verificationCode) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    // Hash the PIN
    const hashedPin = await bcrypt.hash(pin, 10);

    // Update user and mark OTP as used
    await this.prisma.$transaction([
      this.prisma.verificationCode.update({
        where: { id: verificationCode.id },
        data: { used: true },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { withdrawalPin: hashedPin },
      }),
    ]);

    return { message: 'Withdrawal PIN set successfully' };
  }

  async changeWithdrawalPin(
    userId: string,
    currentPin: string,
    newPin: string,
    otp: string,
  ) {
    // Validate new PIN format
    if (!/^\d{4,6}$/.test(newPin)) {
      throw new BadRequestException('PIN must be 4-6 digits');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.withdrawalPin) {
      throw new BadRequestException('No PIN set. Please set a PIN first.');
    }

    // Verify current PIN
    const isPinValid = await bcrypt.compare(currentPin, user.withdrawalPin);
    if (!isPinValid) {
      throw new BadRequestException('Current PIN is incorrect');
    }

    // Verify OTP
    const verificationCode = await this.prisma.verificationCode.findFirst({
      where: {
        userId,
        code: otp,
        type: 'PIN_SETUP',
        used: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!verificationCode) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    // Hash the new PIN
    const hashedPin = await bcrypt.hash(newPin, 10);

    // Update user and mark OTP as used
    await this.prisma.$transaction([
      this.prisma.verificationCode.update({
        where: { id: verificationCode.id },
        data: { used: true },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { withdrawalPin: hashedPin },
      }),
    ]);

    return { message: 'Withdrawal PIN changed successfully' };
  }

  async resetWithdrawalPin(userId: string, newPin: string, otp: string) {
    // Validate new PIN format
    if (!/^\d{4,6}$/.test(newPin)) {
      throw new BadRequestException('PIN must be 4-6 digits');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Verify OTP
    const verificationCode = await this.prisma.verificationCode.findFirst({
      where: {
        userId,
        code: otp,
        type: 'PIN_SETUP',
        used: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!verificationCode) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    // Hash the new PIN
    const hashedPin = await bcrypt.hash(newPin, 10);

    // Update user and mark OTP as used
    await this.prisma.$transaction([
      this.prisma.verificationCode.update({
        where: { id: verificationCode.id },
        data: { used: true },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { withdrawalPin: hashedPin },
      }),
    ]);

    return { message: 'Withdrawal PIN reset successfully' };
  }

  async verifyWithdrawalPin(userId: string, pin: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { withdrawalPin: true },
    });

    if (!user?.withdrawalPin) {
      throw new BadRequestException('No withdrawal PIN set');
    }

    return bcrypt.compare(pin, user.withdrawalPin);
  }
}
