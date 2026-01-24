import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TatumService } from '../tatum/tatum.service';
import { EmailService } from '../email/email.service';
import { WalletPoolService } from './wallet-pool.service';
import { CreateDepositDto } from './dto/deposit.dto';
import { Decimal } from '@prisma/client/runtime/library';
import { ConfigService } from '@nestjs/config';
import { WalletNetwork } from '@prisma/client';

@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);

  constructor(
    private prisma: PrismaService,
    private tatumService: TatumService,
    private emailService: EmailService,
    private configService: ConfigService,
    private walletPoolService: WalletPoolService,
  ) {}

  /**
   * Get deposit address for user
   * Assigns a wallet from the pool for 1 hour
   */
  async getDepositAddress(userId: string, network: string) {
    const walletNetwork = network as WalletNetwork;

    // Validate network
    if (!['BEP20', 'TRC20'].includes(walletNetwork)) {
      throw new BadRequestException('Invalid network. Use BEP20 or TRC20');
    }

    // Get or assign a wallet from the pool
    const { address, expiresAt, isNew } =
      await this.walletPoolService.getOrAssignWallet(userId, walletNetwork);

    const minDeposit = this.configService.get<number>('MIN_DEPOSIT', 100);
    const depositBonus = this.configService.get<number>('DEPOSIT_BONUS_PERCENT', 3);

    this.logger.log(
      `Assigned wallet ${address} to user ${userId}, expires at ${expiresAt}`,
    );

    return {
      address,
      network: walletNetwork,
      expiresAt,
      expiresIn: Math.floor((expiresAt.getTime() - Date.now()) / 1000), // seconds
      minDeposit,
      depositBonus,
      isNewWallet: isNew,
    };
  }

  /**
   * Create a deposit request (optional - for tracking expected deposits)
   */
  async createDeposit(userId: string, createDepositDto: CreateDepositDto) {
    const { amount, network } = createDepositDto;
    const walletNetwork = network as WalletNetwork;

    const minDeposit = this.configService.get<number>('MIN_DEPOSIT', 100);
    if (amount < minDeposit) {
      throw new BadRequestException(`Minimum deposit is $${minDeposit}`);
    }

    // Get the user's assigned wallet
    const assignedWallet = await this.prisma.depositWallet.findFirst({
      where: {
        assignedToUserId: userId,
        network: walletNetwork,
        isAvailable: false,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (!assignedWallet) {
      throw new BadRequestException(
        'No active deposit address. Please get a deposit address first.',
      );
    }

    // Create deposit record with expected amount
    const deposit = await this.prisma.deposit.create({
      data: {
        userId,
        amount: new Decimal(amount),
        network: walletNetwork,
        depositAddress: assignedWallet.address,
        depositWalletId: assignedWallet.id,
        status: 'PENDING',
        expiresAt: assignedWallet.expiresAt,
      },
    });

    return {
      id: deposit.id,
      amount: Number(deposit.amount),
      network: deposit.network,
      depositAddress: deposit.depositAddress,
      status: deposit.status,
      expiresAt: assignedWallet.expiresAt,
      message: `Please send ${amount} USDT to the address below within 1 hour`,
    };
  }

  /**
   * Manually confirm a deposit (admin function or for testing)
   */
  async confirmDeposit(depositId: string, txHash: string) {
    const deposit = await this.prisma.deposit.findUnique({
      where: { id: depositId },
      include: { user: true },
    });

    if (!deposit) {
      throw new NotFoundException('Deposit not found');
    }

    if (deposit.status === 'CONFIRMED') {
      throw new BadRequestException('Deposit already confirmed');
    }

    const depositBonus = this.configService.get<number>(
      'DEPOSIT_BONUS_PERCENT',
      3,
    );
    const bonusAmount = (Number(deposit.amount) * depositBonus) / 100;
    const totalAmount = Number(deposit.amount) + bonusAmount;

    // Update deposit and user balance
    await this.prisma.$transaction([
      this.prisma.deposit.update({
        where: { id: depositId },
        data: {
          status: 'CONFIRMED',
          txHash,
          confirmedAt: new Date(),
          bonusAmount: new Decimal(bonusAmount),
        },
      }),
      this.prisma.user.update({
        where: { id: deposit.userId },
        data: {
          balance: { increment: totalAmount },
          totalDeposits: { increment: Number(deposit.amount) },
        },
      }),
      this.prisma.transaction.create({
        data: {
          userId: deposit.userId,
          type: 'DEPOSIT',
          amount: deposit.amount,
          netAmount: deposit.amount,
          status: 'CONFIRMED',
          reference: txHash,
          description: `Deposit via ${deposit.network}`,
        },
      }),
      this.prisma.transaction.create({
        data: {
          userId: deposit.userId,
          type: 'DEPOSIT_BONUS',
          amount: new Decimal(bonusAmount),
          netAmount: new Decimal(bonusAmount),
          status: 'CONFIRMED',
          description: `${depositBonus}% deposit bonus`,
        },
      }),
    ]);

    // Mark wallet as used if we have the wallet ID
    if (deposit.depositWalletId) {
      await this.walletPoolService.markWalletUsed(deposit.depositWalletId);
    }

    // Process referral bonus
    await this.processReferralBonus(deposit.userId, Number(deposit.amount));

    // Send confirmation email
    await this.emailService.sendDepositConfirmation(
      deposit.user.email,
      deposit.amount.toString(),
      txHash,
    );

    return { message: 'Deposit confirmed successfully' };
  }

  /**
   * Get user's deposit history
   */
  async getDepositHistory(userId: string) {
    return this.prisma.deposit.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        network: true,
        depositAddress: true,
        txHash: true,
        currency: true,
        status: true,
        bonusAmount: true,
        confirmedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Get pending deposits for admin
   */
  async getPendingDeposits() {
    return this.prisma.deposit.findMany({
      where: { status: 'PENDING' },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get wallet pool statistics
   */
  async getPoolStats() {
    return this.walletPoolService.getPoolStats();
  }

  /**
   * Get user's active deposit session
   */
  async getActiveDepositSession(userId: string, network: string) {
    const walletNetwork = network as WalletNetwork;

    const activeWallet = await this.prisma.depositWallet.findFirst({
      where: {
        assignedToUserId: userId,
        network: walletNetwork,
        isAvailable: false,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (!activeWallet) {
      return null;
    }

    return {
      address: activeWallet.address,
      network: activeWallet.network,
      expiresAt: activeWallet.expiresAt,
      expiresIn: Math.floor(
        (activeWallet.expiresAt!.getTime() - Date.now()) / 1000,
      ),
    };
  }

  /**
   * Process referral bonus when deposit is confirmed
   */
  private async processReferralBonus(userId: string, depositAmount: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { referrer: true },
    });

    if (!user?.referrer) return;

    const referralBonusPercent = this.configService.get<number>(
      'REFERRAL_BONUS_PERCENT',
      7,
    );
    const bonusAmount = (depositAmount * referralBonusPercent) / 100;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.referrer.id },
        data: {
          balance: { increment: bonusAmount },
          totalTeamEarnings: { increment: bonusAmount },
        },
      }),
      this.prisma.transaction.create({
        data: {
          userId: user.referrer.id,
          type: 'REFERRAL_BONUS',
          amount: new Decimal(bonusAmount),
          netAmount: new Decimal(bonusAmount),
          status: 'CONFIRMED',
          description: `${referralBonusPercent}% referral bonus from ${user.username}`,
        },
      }),
    ]);
  }
}
