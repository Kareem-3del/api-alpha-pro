import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getWeeklySalaryAmount } from '../common/utils/helpers';

@Injectable()
export class TeamService {
  constructor(private prisma: PrismaService) {}

  async getTeamEarnings(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get team bonuses by level
    const level1Bonuses = await this.prisma.teamBonus.aggregate({
      where: { userId, level: 1 },
      _sum: { amount: true },
      _count: true,
    });

    const level2Bonuses = await this.prisma.teamBonus.aggregate({
      where: { userId, level: 2 },
      _sum: { amount: true },
      _count: true,
    });

    // Get weekly salaries
    const weeklySalaries = await this.prisma.weeklySalary.aggregate({
      where: { userId },
      _sum: { amount: true },
      _count: true,
    });

    // Get recent team bonuses
    const recentBonuses = await this.prisma.teamBonus.findMany({
      where: { userId },
      orderBy: { bonusDate: 'desc' },
      take: 20,
    });

    return {
      totalTeamEarnings: user.totalTeamEarnings,
      level1: {
        totalEarnings: level1Bonuses._sum.amount || 0,
        transactionCount: level1Bonuses._count,
        percentage: 10,
      },
      level2: {
        totalEarnings: level2Bonuses._sum.amount || 0,
        transactionCount: level2Bonuses._count,
        percentage: 5,
      },
      weeklySalary: {
        totalEarnings: weeklySalaries._sum.amount || 0,
        weeksReceived: weeklySalaries._count,
      },
      recentBonuses,
    };
  }

  async getTeamLevels(userId: string) {
    // Level 1 members (direct referrals)
    const level1Members = await this.prisma.user.findMany({
      where: { referredBy: userId },
      select: {
        id: true,
        username: true,
        totalDeposits: true,
        createdAt: true,
        _count: {
          select: {
            investments: { where: { status: 'ACTIVE' } },
          },
        },
      },
    });

    // Level 2 members
    const level1Ids = level1Members.map((m) => m.id);
    const level2Members = await this.prisma.user.findMany({
      where: { referredBy: { in: level1Ids } },
      select: {
        id: true,
        username: true,
        totalDeposits: true,
        createdAt: true,
        referredBy: true,
        _count: {
          select: {
            investments: { where: { status: 'ACTIVE' } },
          },
        },
      },
    });

    // Calculate totals
    const totalLevel1Deposits = level1Members.reduce(
      (sum, m) => sum + Number(m.totalDeposits),
      0,
    );
    const totalLevel2Deposits = level2Members.reduce(
      (sum, m) => sum + Number(m.totalDeposits),
      0,
    );

    return {
      level1: {
        count: level1Members.length,
        totalDeposits: totalLevel1Deposits,
        members: level1Members.map((m) => ({
          id: m.id,
          username: m.username,
          totalDeposits: m.totalDeposits,
          activeInvestments: m._count.investments,
          joinedAt: m.createdAt,
        })),
      },
      level2: {
        count: level2Members.length,
        totalDeposits: totalLevel2Deposits,
        members: level2Members.map((m) => ({
          id: m.id,
          username: m.username,
          totalDeposits: m.totalDeposits,
          activeInvestments: m._count.investments,
          joinedAt: m.createdAt,
          referredBy: m.referredBy,
        })),
      },
      totalTeamSize: level1Members.length + level2Members.length,
      totalTeamDeposits: totalLevel1Deposits + totalLevel2Deposits,
    };
  }

  async getWeeklySalaryInfo(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: { referrals: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const referralCount = user._count.referrals;
    const currentSalary = getWeeklySalaryAmount(referralCount);

    // Calculate next tier
    let nextTier: { referrals: number; salary: number } | null = null;
    let referralsNeeded = 0;

    if (referralCount < 10) {
      nextTier = { referrals: 10, salary: 30 };
      referralsNeeded = 10 - referralCount;
    } else if (referralCount < 25) {
      nextTier = { referrals: 25, salary: 50 };
      referralsNeeded = 25 - referralCount;
    } else if (referralCount < 50) {
      nextTier = { referrals: 50, salary: 75 };
      referralsNeeded = 50 - referralCount;
    } else if (referralCount < 100) {
      nextTier = { referrals: 100, salary: 120 };
      referralsNeeded = 100 - referralCount;
    }

    // Get salary history
    const salaryHistory = await this.prisma.weeklySalary.findMany({
      where: { userId },
      orderBy: { weekStart: 'desc' },
      take: 10,
    });

    return {
      currentReferrals: referralCount,
      currentWeeklySalary: currentSalary,
      nextTier,
      referralsNeeded,
      salaryTiers: [
        { referrals: 10, salary: 30 },
        { referrals: 25, salary: 50 },
        { referrals: 50, salary: 75 },
        { referrals: 100, salary: 120 },
      ],
      history: salaryHistory,
    };
  }
}
