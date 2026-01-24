import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Headers,
  UnauthorizedException,
  Logger,
  Body,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WalletPoolService } from '../deposits/wallet-pool.service';
import { DepositsService } from '../deposits/deposits.service';
import { WalletNetwork } from '@prisma/client';

@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private walletPoolService: WalletPoolService,
    private depositsService: DepositsService,
  ) {}

  /**
   * Verify admin secret
   */
  private verifyAdminAccess(adminSecret: string) {
    const secret = this.configService.get<string>('ADMIN_SECRET');
    if (!secret || adminSecret !== secret) {
      throw new UnauthorizedException('Invalid admin secret');
    }
  }

  // ==================== DASHBOARD STATS ====================

  @Get('stats')
  async getDashboardStats(@Headers('x-admin-secret') adminSecret: string) {
    this.verifyAdminAccess(adminSecret);

    const [
      totalUsers,
      activeUsers,
      totalDeposits,
      pendingDeposits,
      confirmedDeposits,
      failedDeposits,
      walletStats,
      totalBalance,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.deposit.count(),
      this.prisma.deposit.count({ where: { status: 'PENDING' } }),
      this.prisma.deposit.count({ where: { status: 'CONFIRMED' } }),
      this.prisma.deposit.count({ where: { status: 'FAILED' } }),
      this.walletPoolService.getPoolStats(),
      this.prisma.user.aggregate({ _sum: { balance: true } }),
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
      },
      wallets: walletStats,
      totalUserBalance: totalBalance._sum.balance || 0,
    };
  }

  // ==================== WALLET MANAGEMENT ====================

  @Get('wallets')
  async getAllWallets(
    @Headers('x-admin-secret') adminSecret: string,
    @Query('network') network?: string,
  ) {
    this.verifyAdminAccess(adminSecret);

    const wallets = await this.walletPoolService.getAllWallets(
      network as WalletNetwork | undefined,
    );

    return { wallets, count: wallets.length };
  }

  @Get('wallets/:id')
  async getWalletDetails(
    @Headers('x-admin-secret') adminSecret: string,
    @Param('id') walletId: string,
  ) {
    this.verifyAdminAccess(adminSecret);

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
  async getWalletPrivateKey(
    @Headers('x-admin-secret') adminSecret: string,
    @Param('id') walletId: string,
  ) {
    this.verifyAdminAccess(adminSecret);

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
  async getWalletBalance(
    @Headers('x-admin-secret') adminSecret: string,
    @Param('id') walletId: string,
  ) {
    this.verifyAdminAccess(adminSecret);

    const wallet = await this.prisma.depositWallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      return { error: 'Wallet not found' };
    }

    return this.walletPoolService.getWalletBalance(wallet.address, wallet.network);
  }

  @Post('wallets/:id/transfer-to-master')
  async transferToMaster(
    @Headers('x-admin-secret') adminSecret: string,
    @Param('id') walletId: string,
  ) {
    this.verifyAdminAccess(adminSecret);

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
    @Headers('x-admin-secret') adminSecret: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    this.verifyAdminAccess(adminSecret);

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
  async getDepositDetails(
    @Headers('x-admin-secret') adminSecret: string,
    @Param('id') depositId: string,
  ) {
    this.verifyAdminAccess(adminSecret);

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
    @Headers('x-admin-secret') adminSecret: string,
    @Param('id') depositId: string,
    @Body('txHash') txHash: string,
  ) {
    this.verifyAdminAccess(adminSecret);

    this.logger.log(`Admin confirming deposit ${depositId} with txHash ${txHash}`);

    try {
      const result = await this.depositsService.confirmDeposit(depositId, txHash);
      return result;
    } catch (error) {
      return { error: error.message };
    }
  }

  @Post('deposits/:id/cancel')
  async cancelDeposit(
    @Headers('x-admin-secret') adminSecret: string,
    @Param('id') depositId: string,
  ) {
    this.verifyAdminAccess(adminSecret);

    this.logger.log(`Admin cancelling deposit ${depositId}`);

    const deposit = await this.prisma.deposit.update({
      where: { id: depositId },
      data: { status: 'CANCELLED' },
    });

    return { message: 'Deposit cancelled', deposit };
  }

  // ==================== USER MANAGEMENT ====================

  @Get('users')
  async getAllUsers(
    @Headers('x-admin-secret') adminSecret: string,
    @Query('limit') limit?: string,
  ) {
    this.verifyAdminAccess(adminSecret);

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
  async getUserDetails(
    @Headers('x-admin-secret') adminSecret: string,
    @Param('id') userId: string,
  ) {
    this.verifyAdminAccess(adminSecret);

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
}
