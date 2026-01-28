import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { ConfigService } from '@nestjs/config';
import { getWeekBounds, getWeeklySalaryAmount } from '../common/utils/helpers';

@Injectable()
export class ProfitsService {
  private readonly logger = new Logger(ProfitsService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  // TESTING: Run every 5 minutes for Testing package only (remove after testing)
  @Cron(CronExpression.EVERY_5_MINUTES)
  async distributeTestingProfits() {
    this.logger.log('Starting Testing package profit distribution (5min interval)...');

    try {
      // Find the Testing package
      const testingPackage = await this.prisma.package.findUnique({
        where: { name: 'Testing' },
      });

      if (!testingPackage) {
        return; // Testing package not found, skip
      }

      const activeInvestments = await this.prisma.investment.findMany({
        where: {
          status: 'ACTIVE',
          packageId: testingPackage.id,
          endDate: { gt: new Date() },
        },
        include: { user: true },
      });

      if (activeInvestments.length === 0) {
        return;
      }

      for (const investment of activeInvestments) {
        // Calculate profit for 5 minutes (dailyProfit / 288 since 24*60/5 = 288 intervals per day)
        const fiveMinuteProfitAmount =
          (Number(investment.amount) * Number(investment.dailyProfit)) / 100 / 288;

        await this.prisma.$transaction([
          this.prisma.user.update({
            where: { id: investment.userId },
            data: {
              balance: { increment: fiveMinuteProfitAmount },
              totalProfit: { increment: fiveMinuteProfitAmount },
            },
          }),
          this.prisma.investment.update({
            where: { id: investment.id },
            data: {
              totalProfit: { increment: fiveMinuteProfitAmount },
              lastProfitAt: new Date(),
            },
          }),
          this.prisma.profitRecord.create({
            data: {
              userId: investment.userId,
              investmentId: investment.id,
              amount: new Decimal(fiveMinuteProfitAmount),
              profitDate: new Date(),
            },
          }),
          this.prisma.transaction.create({
            data: {
              userId: investment.userId,
              type: 'PROFIT',
              amount: new Decimal(fiveMinuteProfitAmount),
              netAmount: new Decimal(fiveMinuteProfitAmount),
              status: 'CONFIRMED',
              description: `Testing profit (5min interval)`,
            },
          }),
        ]);

        // Process team commissions for testing profits too
        await this.processTeamCommission(investment.userId, fiveMinuteProfitAmount);
      }

      this.logger.log(
        `Testing profit distribution completed for ${activeInvestments.length} investments`,
      );
    } catch (error) {
      this.logger.error('Error distributing testing profits', error);
    }
  }

  // Run every day at midnight UTC
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async distributeDailyProfits() {
    this.logger.log('Starting daily profit distribution...');

    try {
      const activeInvestments = await this.prisma.investment.findMany({
        where: {
          status: 'ACTIVE',
          endDate: { gt: new Date() },
        },
        include: { user: true },
      });

      for (const investment of activeInvestments) {
        const dailyProfitAmount =
          (Number(investment.amount) * Number(investment.dailyProfit)) / 100;

        await this.prisma.$transaction([
          // Credit profit to user
          this.prisma.user.update({
            where: { id: investment.userId },
            data: {
              balance: { increment: dailyProfitAmount },
              totalProfit: { increment: dailyProfitAmount },
            },
          }),
          // Update investment total profit
          this.prisma.investment.update({
            where: { id: investment.id },
            data: {
              totalProfit: { increment: dailyProfitAmount },
              lastProfitAt: new Date(),
            },
          }),
          // Create profit record
          this.prisma.profitRecord.create({
            data: {
              userId: investment.userId,
              investmentId: investment.id,
              amount: new Decimal(dailyProfitAmount),
              profitDate: new Date(),
            },
          }),
          // Create transaction
          this.prisma.transaction.create({
            data: {
              userId: investment.userId,
              type: 'PROFIT',
              amount: new Decimal(dailyProfitAmount),
              netAmount: new Decimal(dailyProfitAmount),
              status: 'CONFIRMED',
              description: `Daily profit from investment`,
            },
          }),
        ]);

        // Process team commissions
        await this.processTeamCommission(investment.userId, dailyProfitAmount);
      }

      // Check and complete matured investments
      await this.completeMaturedInvestments();

      this.logger.log(
        `Daily profit distribution completed for ${activeInvestments.length} investments`,
      );
    } catch (error) {
      this.logger.error('Error distributing daily profits', error);
    }
  }

  private async processTeamCommission(userId: string, profitAmount: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        referrer: {
          include: { referrer: true },
        },
      },
    });

    if (!user?.referrer) return;

    const level1Percent = this.configService.get<number>(
      'TEAM_LEVEL1_PERCENT',
      10,
    );
    const level2Percent = this.configService.get<number>(
      'TEAM_LEVEL2_PERCENT',
      5,
    );

    // Level 1 commission (10%)
    const level1Commission = (profitAmount * level1Percent) / 100;
    await this.creditTeamBonus(
      user.referrer.id,
      userId,
      1,
      level1Percent,
      level1Commission,
    );

    // Level 2 commission (5%)
    if (user.referrer.referrer) {
      const level2Commission = (profitAmount * level2Percent) / 100;
      await this.creditTeamBonus(
        user.referrer.referrer.id,
        userId,
        2,
        level2Percent,
        level2Commission,
      );
    }
  }

  private async creditTeamBonus(
    userId: string,
    fromUserId: string,
    level: number,
    percentage: number,
    amount: number,
  ) {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          balance: { increment: amount },
          totalTeamEarnings: { increment: amount },
        },
      }),
      this.prisma.teamBonus.create({
        data: {
          userId,
          fromUserId,
          level,
          percentage: new Decimal(percentage),
          amount: new Decimal(amount),
          bonusDate: new Date(),
        },
      }),
      this.prisma.transaction.create({
        data: {
          userId,
          type: 'TEAM_COMMISSION',
          amount: new Decimal(amount),
          netAmount: new Decimal(amount),
          status: 'CONFIRMED',
          description: `Level ${level} team commission (${percentage}%)`,
        },
      }),
    ]);
  }

  private async completeMaturedInvestments() {
    const maturedInvestments = await this.prisma.investment.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { lte: new Date() },
      },
    });

    for (const investment of maturedInvestments) {
      await this.prisma.investment.update({
        where: { id: investment.id },
        data: { status: 'COMPLETED' },
      });
    }

    this.logger.log(
      `Completed ${maturedInvestments.length} matured investments`,
    );
  }

  // Run every Sunday at midnight UTC
  @Cron('0 0 * * 0')
  async distributeWeeklySalary() {
    this.logger.log('Starting weekly salary distribution...');

    try {
      // Get the week that just ended (Saturday to Saturday)
      const { weekStart, weekEnd } = getWeekBounds(new Date());

      // Get all users with their referral counts (only count verified referrals with deposits)
      const users = await this.prisma.user.findMany({
        where: { status: 'ACTIVE' },
        include: {
          _count: {
            select: {
              referrals: {
                where: {
                  emailVerified: true,
                  totalDeposits: { gt: 0 },
                },
              },
            },
          },
        },
      });

      for (const user of users) {
        // Only count referrals with verified email AND at least one deposit
        const referralCount = user._count.referrals;
        const salaryAmount = getWeeklySalaryAmount(referralCount);

        if (salaryAmount > 0) {
          await this.prisma.$transaction([
            this.prisma.user.update({
              where: { id: user.id },
              data: {
                balance: { increment: salaryAmount },
                totalTeamEarnings: { increment: salaryAmount },
              },
            }),
            this.prisma.weeklySalary.create({
              data: {
                userId: user.id,
                referralCount,
                amount: new Decimal(salaryAmount),
                weekStart,
                weekEnd,
              },
            }),
            this.prisma.transaction.create({
              data: {
                userId: user.id,
                type: 'WEEKLY_SALARY',
                amount: new Decimal(salaryAmount),
                netAmount: new Decimal(salaryAmount),
                status: 'CONFIRMED',
                description: `Weekly team salary (${referralCount} referrals)`,
              },
            }),
          ]);
        }
      }

      this.logger.log('Weekly salary distribution completed');
    } catch (error) {
      this.logger.error('Error distributing weekly salary', error);
    }
  }

  // Manual trigger for testing
  async triggerDailyProfits() {
    await this.distributeDailyProfits();
    return { message: 'Daily profits distributed' };
  }

  async triggerWeeklySalary() {
    await this.distributeWeeklySalary();
    return { message: 'Weekly salary distributed' };
  }

  async getProfitHistory(userId: string) {
    return this.prisma.profitRecord.findMany({
      where: { userId },
      include: { investment: { include: { package: true } } },
      orderBy: { profitDate: 'desc' },
    });
  }

  async getTeamBonusHistory(userId: string) {
    return this.prisma.teamBonus.findMany({
      where: { userId },
      orderBy: { bonusDate: 'desc' },
    });
  }

  async getWeeklySalaryHistory(userId: string) {
    return this.prisma.weeklySalary.findMany({
      where: { userId },
      orderBy: { weekStart: 'desc' },
    });
  }

  // TESTING: Cleanup testing data (remove after testing)
  async cleanupTestingData() {
    this.logger.log('Starting Testing data cleanup...');

    try {
      const testingPackage = await this.prisma.package.findUnique({
        where: { name: 'Testing' },
      });

      if (!testingPackage) {
        return { message: 'Testing package not found, nothing to clean up' };
      }

      // Get all testing investments
      const testingInvestments = await this.prisma.investment.findMany({
        where: { packageId: testingPackage.id },
        select: { id: true, userId: true },
      });

      const investmentIds = testingInvestments.map((i) => i.id);

      // Delete profit records for testing investments
      const deletedProfitRecords = await this.prisma.profitRecord.deleteMany({
        where: { investmentId: { in: investmentIds } },
      });

      // Delete transactions related to testing (by description)
      const deletedTransactions = await this.prisma.transaction.deleteMany({
        where: {
          OR: [
            { description: { contains: 'Testing profit' } },
            { description: { contains: 'Investment in Testing package' } },
          ],
        },
      });

      // Delete testing investments
      const deletedInvestments = await this.prisma.investment.deleteMany({
        where: { packageId: testingPackage.id },
      });

      // Deactivate the Testing package (don't delete to avoid foreign key issues)
      await this.prisma.package.update({
        where: { id: testingPackage.id },
        data: { isActive: false },
      });

      this.logger.log('Testing data cleanup completed');

      return {
        message: 'Testing data cleaned up successfully',
        deleted: {
          profitRecords: deletedProfitRecords.count,
          transactions: deletedTransactions.count,
          investments: deletedInvestments.count,
        },
        note: 'User balances were NOT reverted. Please adjust manually if needed.',
      };
    } catch (error) {
      this.logger.error('Error cleaning up testing data', error);
      throw error;
    }
  }
}
