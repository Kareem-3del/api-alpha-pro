import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { TatumService } from '../tatum/tatum.service';
import { EmailService } from '../email/email.service';
import { CreateWithdrawalDto } from './dto/withdrawal.dto';
import { Decimal } from '@prisma/client/runtime/library';
import { ConfigService } from '@nestjs/config';
import { calculateWithdrawalFee } from '../common/utils/helpers';

@Injectable()
export class WithdrawalsService {
  constructor(
    private prisma: PrismaService,
    private tatumService: TatumService,
    private emailService: EmailService,
    private configService: ConfigService,
  ) {}

  async createWithdrawal(
    userId: string,
    createWithdrawalDto: CreateWithdrawalDto,
  ) {
    const { amount, network, pin } = createWithdrawalDto;

    const minWithdrawal = this.configService.get<number>('MIN_WITHDRAWAL', 5);
    if (amount < minWithdrawal) {
      throw new BadRequestException(`Minimum withdrawal is $${minWithdrawal}`);
    }

    // Get user with wallet
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Verify withdrawal PIN
    if (!user.withdrawalPin) {
      throw new BadRequestException(
        'Please set a withdrawal PIN in your profile first',
      );
    }

    const isPinValid = await bcrypt.compare(pin, user.withdrawalPin);
    if (!isPinValid) {
      throw new BadRequestException('Invalid withdrawal PIN');
    }

    if (!user.wallet) {
      throw new BadRequestException('Please link a wallet first');
    }

    // Check balance
    if (Number(user.balance) < amount) {
      throw new BadRequestException('Insufficient balance');
    }

    // Calculate fees
    const { fee, netAmount } = calculateWithdrawalFee(amount, network);

    if (netAmount <= 0) {
      throw new BadRequestException('Amount too low after fees');
    }

    // Create withdrawal and deduct balance
    const [withdrawal] = await this.prisma.$transaction([
      this.prisma.withdrawal.create({
        data: {
          userId,
          amount: new Decimal(amount),
          fee: new Decimal(fee),
          netAmount: new Decimal(netAmount),
          network,
          toAddress: user.wallet.address,
          status: 'PENDING',
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          balance: { decrement: amount },
        },
      }),
      this.prisma.transaction.create({
        data: {
          userId,
          type: 'WITHDRAWAL',
          amount: new Decimal(amount),
          fee: new Decimal(fee),
          netAmount: new Decimal(netAmount),
          status: 'PENDING',
          description: `Withdrawal to ${user.wallet.address.slice(0, 10)}...`,
        },
      }),
    ]);

    return {
      id: withdrawal.id,
      amount: withdrawal.amount,
      fee: withdrawal.fee,
      netAmount: withdrawal.netAmount,
      network: withdrawal.network,
      toAddress: withdrawal.toAddress,
      status: withdrawal.status,
      message: 'Withdrawal request submitted',
    };
  }

  async getWithdrawalHistory(userId: string) {
    return this.prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async processWithdrawal(withdrawalId: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: { user: true },
    });

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal not found');
    }

    if (withdrawal.status !== 'PENDING') {
      throw new BadRequestException('Withdrawal already processed');
    }

    try {
      // In production, use Tatum to send the withdrawal
      // const { txId } = await this.tatumService.sendUsdt(
      //   privateKey,
      //   withdrawal.toAddress,
      //   withdrawal.netAmount.toString(),
      // );

      // For now, simulate successful withdrawal
      const txId = `0x${Date.now().toString(16)}`;

      await this.prisma.$transaction([
        this.prisma.withdrawal.update({
          where: { id: withdrawalId },
          data: {
            status: 'CONFIRMED',
            txHash: txId,
            processedAt: new Date(),
          },
        }),
        this.prisma.user.update({
          where: { id: withdrawal.userId },
          data: {
            totalWithdrawals: { increment: Number(withdrawal.amount) },
          },
        }),
        this.prisma.transaction.updateMany({
          where: {
            userId: withdrawal.userId,
            type: 'WITHDRAWAL',
            status: 'PENDING',
          },
          data: {
            status: 'CONFIRMED',
            reference: txId,
          },
        }),
      ]);

      // Send notification email
      await this.emailService.sendWithdrawalNotification(
        withdrawal.user.email,
        withdrawal.netAmount.toString(),
        'CONFIRMED',
      );

      return { message: 'Withdrawal processed successfully', txId };
    } catch (error) {
      // Refund on failure
      await this.prisma.$transaction([
        this.prisma.withdrawal.update({
          where: { id: withdrawalId },
          data: { status: 'FAILED' },
        }),
        this.prisma.user.update({
          where: { id: withdrawal.userId },
          data: {
            balance: { increment: Number(withdrawal.amount) },
          },
        }),
        this.prisma.transaction.updateMany({
          where: {
            userId: withdrawal.userId,
            type: 'WITHDRAWAL',
            status: 'PENDING',
          },
          data: { status: 'FAILED' },
        }),
      ]);

      await this.emailService.sendWithdrawalNotification(
        withdrawal.user.email,
        withdrawal.amount.toString(),
        'FAILED',
      );

      throw error;
    }
  }

  async getPendingWithdrawals() {
    return this.prisma.withdrawal.findMany({
      where: { status: 'PENDING' },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  calculateFees(amount: number, network: 'BEP20' | 'TRC20') {
    return calculateWithdrawalFee(amount, network);
  }
}
