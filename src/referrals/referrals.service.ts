import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReferralsService {
  constructor(private prisma: PrismaService) {}

  async getReferralCode(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return { referralCode: user.referralCode };
  }

  async getReferrals(userId: string) {
    const referrals = await this.prisma.user.findMany({
      where: { referredBy: userId },
      select: {
        id: true,
        username: true,
        createdAt: true,
        totalDeposits: true,
        _count: {
          select: { referrals: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return referrals.map((ref) => ({
      id: ref.id,
      username: ref.username,
      joinedAt: ref.createdAt,
      totalDeposits: ref.totalDeposits,
      teamSize: ref._count.referrals,
    }));
  }

  async getReferralStats(userId: string) {
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

    // Get level 1 referrals (direct)
    const level1Referrals = await this.prisma.user.findMany({
      where: { referredBy: userId },
      select: {
        id: true,
        totalDeposits: true,
        _count: { select: { referrals: true } },
      },
    });

    // Get level 2 referrals
    const level1Ids = level1Referrals.map((r) => r.id);
    const level2Count = await this.prisma.user.count({
      where: { referredBy: { in: level1Ids } },
    });

    // Calculate total team deposits
    const totalLevel1Deposits = level1Referrals.reduce(
      (sum, r) => sum + Number(r.totalDeposits),
      0,
    );

    // Get referral bonuses earned
    const referralBonuses = await this.prisma.transaction.aggregate({
      where: {
        userId,
        type: 'REFERRAL_BONUS',
        status: 'CONFIRMED',
      },
      _sum: { amount: true },
    });

    // Get team commissions earned
    const teamCommissions = await this.prisma.teamBonus.aggregate({
      where: { userId },
      _sum: { amount: true },
    });

    return {
      referralCode: user.referralCode,
      level1Count: user._count.referrals,
      level2Count,
      totalTeamSize: user._count.referrals + level2Count,
      totalTeamDeposits: totalLevel1Deposits,
      totalReferralBonuses: referralBonuses._sum.amount || 0,
      totalTeamCommissions: teamCommissions._sum.amount || 0,
      totalEarnings: user.totalTeamEarnings,
    };
  }

  async getTeamTree(userId: string, depth: number = 2) {
    const buildTree = async (
      parentId: string,
      currentDepth: number,
    ): Promise<any[]> => {
      if (currentDepth > depth) return [];

      const children = await this.prisma.user.findMany({
        where: { referredBy: parentId },
        select: {
          id: true,
          username: true,
          totalDeposits: true,
          createdAt: true,
        },
      });

      const result: any[] = [];
      for (const child of children) {
        const subChildren = await buildTree(child.id, currentDepth + 1);
        result.push({
          ...child,
          level: currentDepth,
          children: subChildren,
        });
      }

      return result;
    };

    return buildTree(userId, 1);
  }
}
