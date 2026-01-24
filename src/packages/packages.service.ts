import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InvestDto } from './dto/invest.dto';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class PackagesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.package.findMany({
      where: { isActive: true },
      orderBy: { durationDays: 'asc' },
    });
  }

  async findOne(id: string) {
    const pkg = await this.prisma.package.findUnique({
      where: { id },
    });

    if (!pkg) {
      throw new NotFoundException('Package not found');
    }

    return pkg;
  }

  async invest(userId: string, investDto: InvestDto) {
    const { packageId, amount } = investDto;

    // Get user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check balance
    if (Number(user.balance) < amount) {
      throw new BadRequestException('Insufficient balance');
    }

    // Get package
    const pkg = await this.prisma.package.findUnique({
      where: { id: packageId },
    });

    if (!pkg || !pkg.isActive) {
      throw new NotFoundException('Package not found or inactive');
    }

    // Validate amount
    if (amount < Number(pkg.minAmount) || amount > Number(pkg.maxAmount)) {
      throw new BadRequestException(
        `Amount must be between ${pkg.minAmount.toString()} and ${pkg.maxAmount.toString()}`,
      );
    }

    // Calculate end date
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + pkg.durationDays);

    // Create investment and deduct balance
    const [investment] = await this.prisma.$transaction([
      this.prisma.investment.create({
        data: {
          userId,
          packageId,
          amount: new Decimal(amount),
          dailyProfit: pkg.dailyProfit,
          endDate,
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
          type: 'DEPOSIT',
          amount: new Decimal(amount),
          netAmount: new Decimal(amount),
          status: 'CONFIRMED',
          description: `Investment in ${pkg.name} package`,
        },
      }),
    ]);

    return {
      message: 'Investment created successfully',
      investment: {
        id: investment.id,
        packageName: pkg.name,
        amount: investment.amount,
        dailyProfit: investment.dailyProfit,
        startDate: investment.startDate,
        endDate: investment.endDate,
      },
    };
  }

  async getUserInvestments(userId: string) {
    return this.prisma.investment.findMany({
      where: { userId },
      include: { package: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getActiveInvestments(userId: string) {
    return this.prisma.investment.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { package: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Seed default packages
  async seedPackages() {
    const packages = [
      {
        name: 'Bronze',
        durationDays: 30,
        dailyProfit: new Decimal(3.5),
        minAmount: new Decimal(100),
        maxAmount: new Decimal(10000),
      },
      {
        name: 'Silver',
        durationDays: 90,
        dailyProfit: new Decimal(4.0),
        minAmount: new Decimal(100),
        maxAmount: new Decimal(50000),
      },
      {
        name: 'Gold',
        durationDays: 180,
        dailyProfit: new Decimal(4.6),
        minAmount: new Decimal(100),
        maxAmount: new Decimal(100000),
      },
    ];

    for (const pkg of packages) {
      await this.prisma.package.upsert({
        where: { name: pkg.name },
        update: pkg,
        create: pkg,
      });
    }

    return { message: 'Packages seeded successfully' };
  }
}
