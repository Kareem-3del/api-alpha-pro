import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Logger,
  Body,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WalletPoolService } from '../deposits/wallet-pool.service';
import { DepositsService } from '../deposits/deposits.service';
import { WithdrawalsService } from '../withdrawals/withdrawals.service';
import { WalletNetwork } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { Decimal } from '@prisma/client/runtime/library';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private walletPoolService: WalletPoolService,
    private depositsService: DepositsService,
    private withdrawalsService: WithdrawalsService,
  ) {}

  // ==================== DASHBOARD STATS ====================

  @Get('stats')
  async getDashboardStats() {
    const [
      totalUsers,
      activeUsers,
      totalDeposits,
      pendingDeposits,
      confirmedDeposits,
      failedDeposits,
      walletStats,
      totalBalance,
      totalDepositAmount,
      totalWithdrawalAmount,
      totalPendingWithdrawals,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.deposit.count(),
      this.prisma.deposit.count({ where: { status: 'PENDING' } }),
      this.prisma.deposit.count({ where: { status: 'CONFIRMED' } }),
      this.prisma.deposit.count({ where: { status: 'FAILED' } }),
      this.walletPoolService.getPoolStats(),
      this.prisma.user.aggregate({ _sum: { balance: true } }),
      this.prisma.deposit.aggregate({ _sum: { amount: true }, where: { status: 'CONFIRMED' } }),
      this.prisma.withdrawal.aggregate({ _sum: { amount: true }, where: { status: 'CONFIRMED' } }),
      this.prisma.withdrawal.count({ where: { status: 'PENDING' } }),
    ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
      },
      deposits: {
        total: totalDeposits,
        pending: pendingDeposits,
        confirmed: confirmedDeposits,
        failed: failedDeposits,
        totalAmount: totalDepositAmount._sum?.amount || 0,
      },
      withdrawals: {
        totalAmount: totalWithdrawalAmount._sum?.amount || 0,
        pending: totalPendingWithdrawals,
      },
      wallets: walletStats,
      totalUserBalance: totalBalance._sum?.balance || 0,
    };
  }

  // ==================== WALLET MANAGEMENT ====================

  @Get('wallets')
  async getAllWallets(@Query('network') network?: string) {
    const wallets = await this.walletPoolService.getAllWallets(
      network as WalletNetwork | undefined,
    );

    return { wallets, count: wallets.length };
  }

  @Get('wallets/:id')
  async getWalletDetails(@Param('id') walletId: string) {
    const wallet = await this.prisma.depositWallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      return { error: 'Wallet not found' };
    }

    // Get balance from blockchain
    const balance = await this.walletPoolService.getWalletBalance(
      wallet.address,
      wallet.network,
    );

    return {
      ...wallet,
      privateKey: undefined, // Don't expose encrypted key
      balance,
    };
  }

  @Get('wallets/:id/private-key')
  async getWalletPrivateKey(@Param('id') walletId: string) {
    const wallet = await this.walletPoolService.getWalletWithPrivateKey(walletId);

    if (!wallet) {
      return { error: 'Wallet not found' };
    }

    this.logger.warn(`Admin accessed private key for wallet ${walletId}`);

    return {
      id: wallet.id,
      address: wallet.address,
      network: wallet.network,
      privateKey: wallet.decryptedPrivateKey,
    };
  }

  @Get('wallets/:id/balance')
  async getWalletBalance(@Param('id') walletId: string) {
    const wallet = await this.prisma.depositWallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      return { error: 'Wallet not found' };
    }

    return this.walletPoolService.getWalletBalance(wallet.address, wallet.network);
  }

  @Post('wallets/:id/transfer-to-master')
  async transferToMaster(@Param('id') walletId: string) {
    this.logger.log(`Admin initiated transfer to master for wallet ${walletId}`);

    try {
      const result = await this.walletPoolService.transferToMaster(walletId);
      return result;
    } catch (error) {
      this.logger.error(`Transfer failed: ${error.message}`);
      return { error: error.message };
    }
  }

  // ==================== DEPOSIT MANAGEMENT ====================

  @Get('deposits')
  async getAllDeposits(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const where = status ? { status: status as any } : {};
    const take = limit ? parseInt(limit) : 100;

    const deposits = await this.prisma.deposit.findMany({
      where,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    return { deposits, count: deposits.length };
  }

  @Get('deposits/:id')
  async getDepositDetails(@Param('id') depositId: string) {
    const deposit = await this.prisma.deposit.findUnique({
      where: { id: depositId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    return deposit;
  }

  @Post('deposits/:id/confirm')
  async confirmDeposit(
    @Param('id') depositId: string,
    @Body('txHash') txHash: string,
  ) {
    this.logger.log(`Admin confirming deposit ${depositId} with txHash ${txHash}`);

    try {
      const result = await this.depositsService.confirmDeposit(depositId, txHash);
      return result;
    } catch (error) {
      return { error: error.message };
    }
  }

  @Post('deposits/:id/cancel')
  async cancelDeposit(@Param('id') depositId: string) {
    this.logger.log(`Admin cancelling deposit ${depositId}`);

    const deposit = await this.prisma.deposit.update({
      where: { id: depositId },
      data: { status: 'CANCELLED' },
    });

    return { message: 'Deposit cancelled', deposit };
  }

  // ==================== USER MANAGEMENT ====================

  @Get('users')
  async getAllUsers(@Query('limit') limit?: string) {
    const take = limit ? parseInt(limit) : 100;

    const users = await this.prisma.user.findMany({
      take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        username: true,
        email: true,
        status: true,
        balance: true,
        totalDeposits: true,
        totalWithdrawals: true,
        totalProfit: true,
        referralCode: true,
        createdAt: true,
      },
    });

    return { users, count: users.length };
  }

  @Get('users/:id')
  async getUserDetails(@Param('id') userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: true,
        deposits: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        withdrawals: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        investments: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    return user;
  }

  // ==================== WITHDRAWAL MANAGEMENT ====================

  @Get('withdrawals')
  async getAllWithdrawals(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const where = status ? { status: status as any } : {};
    const take = limit ? parseInt(limit) : 100;

    const withdrawals = await this.prisma.withdrawal.findMany({
      where,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            wallet: {
              select: {
                address: true,
                network: true,
              },
            },
          },
        },
      },
    });

    // Get summary stats
    const stats = await this.prisma.withdrawal.groupBy({
      by: ['status'],
      _count: true,
      _sum: { amount: true },
    });

    return {
      withdrawals,
      count: withdrawals.length,
      stats: stats.reduce((acc, s) => {
        acc[s.status] = { count: s._count, total: s._sum.amount };
        return acc;
      }, {}),
    };
  }

  @Get('withdrawals/pending')
  async getPendingWithdrawals() {
    const withdrawals = await this.prisma.withdrawal.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            balance: true,
          },
        },
      },
    });

    const totalPending = withdrawals.reduce(
      (sum, w) => sum + Number(w.netAmount),
      0,
    );

    return {
      withdrawals,
      count: withdrawals.length,
      totalPending,
    };
  }

  @Get('withdrawals/:id')
  async getWithdrawalDetails(@Param('id') withdrawalId: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            balance: true,
            wallet: true,
          },
        },
      },
    });

    return withdrawal;
  }

  @Post('withdrawals/:id/approve')
  async approveWithdrawal(@Param('id') withdrawalId: string) {
    this.logger.log(`Admin approving withdrawal ${withdrawalId}`);

    try {
      const result = await this.withdrawalsService.processWithdrawal(withdrawalId);
      return {
        success: true,
        ...result,
      };
    } catch (error) {
      this.logger.error(`Withdrawal approval failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  @Post('withdrawals/:id/reject')
  async rejectWithdrawal(
    @Param('id') withdrawalId: string,
    @Body('reason') reason?: string,
  ) {
    this.logger.log(`Admin rejecting withdrawal ${withdrawalId}`);

    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: { user: true },
    });

    if (!withdrawal) {
      return { success: false, error: 'Withdrawal not found' };
    }

    if (withdrawal.status !== 'PENDING') {
      return { success: false, error: 'Withdrawal already processed' };
    }

    // Refund the user's balance
    await this.prisma.$transaction([
      this.prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: 'CANCELLED',
          processedAt: new Date(),
        },
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
        data: {
          status: 'CANCELLED',
          description: reason ? `Rejected: ${reason}` : 'Withdrawal rejected',
        },
      }),
    ]);

    this.logger.log(`Withdrawal ${withdrawalId} rejected. Balance refunded.`);

    return {
      success: true,
      message: 'Withdrawal rejected and balance refunded',
      refundedAmount: withdrawal.amount,
    };
  }

  @Post('withdrawals/:id/manual-complete')
  async manualCompleteWithdrawal(
    @Param('id') withdrawalId: string,
    @Body('txHash') txHash: string,
  ) {
    this.logger.log(`Admin manually completing withdrawal ${withdrawalId} with txHash ${txHash}`);

    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: { user: true },
    });

    if (!withdrawal) {
      return { success: false, error: 'Withdrawal not found' };
    }

    if (withdrawal.status !== 'PENDING') {
      return { success: false, error: 'Withdrawal already processed' };
    }

    await this.prisma.$transaction([
      this.prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: 'CONFIRMED',
          txHash,
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
          reference: txHash,
        },
      }),
    ]);

    return {
      success: true,
      message: 'Withdrawal manually completed',
      txHash,
    };
  }
}
