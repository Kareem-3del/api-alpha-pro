import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionQueryDto, TransactionStatsDto, PaginatedTransactionsDto } from './dto/transaction.dto';
import { Prisma, TransactionType } from '@prisma/client';

@Injectable()
export class TransactionsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get paginated transactions with filtering
   */
  async getTransactions(
    userId: string,
    query: TransactionQueryDto,
  ): Promise<PaginatedTransactionsDto> {
    const { type, status, startDate, endDate, page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    const where: Prisma.TransactionWhereInput = {
      userId,
      ...(type && { type }),
      ...(status && { status }),
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate && { gte: new Date(startDate) }),
              ...(endDate && { lte: new Date(endDate) }),
            },
          }
        : {}),
    };

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          type: true,
          amount: true,
          fee: true,
          netAmount: true,
          status: true,
          reference: true,
          description: true,
          metadata: true,
          createdAt: true,
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: transactions.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: Number(tx.amount),
        fee: Number(tx.fee),
        netAmount: Number(tx.netAmount),
        status: tx.status,
        reference: tx.reference,
        description: tx.description,
        metadata: tx.metadata,
        createdAt: tx.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get single transaction by ID
   */
  async getTransactionById(userId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: {
        id: transactionId,
        userId,
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return {
      id: transaction.id,
      type: transaction.type,
      amount: Number(transaction.amount),
      fee: Number(transaction.fee),
      netAmount: Number(transaction.netAmount),
      status: transaction.status,
      reference: transaction.reference,
      description: transaction.description,
      metadata: transaction.metadata,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };
  }

  /**
   * Get transaction statistics for a user
   */
  async getTransactionStats(userId: string): Promise<TransactionStatsDto> {
    const transactions = await this.prisma.transaction.groupBy({
      by: ['type', 'status'],
      where: { userId },
      _sum: {
        netAmount: true,
      },
      _count: true,
    });

    const stats: TransactionStatsDto = {
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalProfits: 0,
      totalReferralBonuses: 0,
      totalTeamCommissions: 0,
      totalWeeklySalaries: 0,
      totalDepositBonuses: 0,
      pendingTransactions: 0,
      netBalance: 0,
    };

    for (const group of transactions) {
      const amount = Number(group._sum.netAmount || 0);

      if (group.status === 'PENDING') {
        stats.pendingTransactions += group._count;
      }

      if (group.status !== 'CONFIRMED') continue;

      switch (group.type) {
        case TransactionType.DEPOSIT:
          stats.totalDeposits += amount;
          stats.netBalance += amount;
          break;
        case TransactionType.WITHDRAWAL:
          stats.totalWithdrawals += amount;
          stats.netBalance -= amount;
          break;
        case TransactionType.PROFIT:
          stats.totalProfits += amount;
          stats.netBalance += amount;
          break;
        case TransactionType.REFERRAL_BONUS:
          stats.totalReferralBonuses += amount;
          stats.netBalance += amount;
          break;
        case TransactionType.TEAM_COMMISSION:
          stats.totalTeamCommissions += amount;
          stats.netBalance += amount;
          break;
        case TransactionType.WEEKLY_SALARY:
          stats.totalWeeklySalaries += amount;
          stats.netBalance += amount;
          break;
        case TransactionType.DEPOSIT_BONUS:
          stats.totalDepositBonuses += amount;
          stats.netBalance += amount;
          break;
      }
    }

    return stats;
  }

  /**
   * Get transactions by type
   */
  async getTransactionsByType(
    userId: string,
    type: TransactionType,
    query: Omit<TransactionQueryDto, 'type'>,
  ): Promise<PaginatedTransactionsDto> {
    return this.getTransactions(userId, { ...query, type });
  }

  /**
   * Get recent transactions (for dashboard)
   */
  async getRecentTransactions(userId: string, limit: number = 10) {
    const transactions = await this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        amount: true,
        fee: true,
        netAmount: true,
        status: true,
        reference: true,
        description: true,
        createdAt: true,
      },
    });

    return transactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      amount: Number(tx.amount),
      fee: Number(tx.fee),
      netAmount: Number(tx.netAmount),
      status: tx.status,
      reference: tx.reference,
      description: tx.description,
      createdAt: tx.createdAt,
    }));
  }

  /**
   * Get monthly transaction summary
   */
  async getMonthlySummary(userId: string, year: number, month: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const transactions = await this.prisma.transaction.groupBy({
      by: ['type'],
      where: {
        userId,
        status: 'CONFIRMED',
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      _sum: {
        netAmount: true,
      },
      _count: true,
    });

    const summary: Record<string, { count: number; total: number }> = {};

    for (const group of transactions) {
      summary[group.type] = {
        count: group._count,
        total: Number(group._sum.netAmount || 0),
      };
    }

    return {
      year,
      month,
      startDate,
      endDate,
      summary,
    };
  }
}
