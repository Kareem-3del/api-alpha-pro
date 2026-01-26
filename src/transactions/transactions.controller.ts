import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TransactionQueryDto } from './dto/transaction.dto';
import type { AuthenticatedUser } from '../common/types/user.type';
import { TransactionType } from '@prisma/client';

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private transactionsService: TransactionsService) {}

  /**
   * Get all transactions with filtering and pagination
   * GET /transactions?type=DEPOSIT&status=CONFIRMED&page=1&limit=20
   */
  @Get()
  async getTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TransactionQueryDto,
  ) {
    return this.transactionsService.getTransactions(user.id, query);
  }

  /**
   * Get transaction statistics
   * GET /transactions/stats
   */
  @Get('stats')
  async getTransactionStats(@CurrentUser() user: AuthenticatedUser) {
    return this.transactionsService.getTransactionStats(user.id);
  }

  /**
   * Get recent transactions (for dashboard widget)
   * GET /transactions/recent?limit=10
   */
  @Get('recent')
  async getRecentTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
  ) {
    return this.transactionsService.getRecentTransactions(
      user.id,
      limit ? parseInt(limit, 10) : 10,
    );
  }

  /**
   * Get monthly summary
   * GET /transactions/summary/monthly?year=2024&month=1
   */
  @Get('summary/monthly')
  async getMonthlySummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const currentDate = new Date();
    return this.transactionsService.getMonthlySummary(
      user.id,
      year ? parseInt(year, 10) : currentDate.getFullYear(),
      month ? parseInt(month, 10) : currentDate.getMonth() + 1,
    );
  }

  /**
   * Get deposits only
   * GET /transactions/deposits
   */
  @Get('deposits')
  async getDeposits(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Omit<TransactionQueryDto, 'type'>,
  ) {
    return this.transactionsService.getTransactionsByType(
      user.id,
      TransactionType.DEPOSIT,
      query,
    );
  }

  /**
   * Get withdrawals only
   * GET /transactions/withdrawals
   */
  @Get('withdrawals')
  async getWithdrawals(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Omit<TransactionQueryDto, 'type'>,
  ) {
    return this.transactionsService.getTransactionsByType(
      user.id,
      TransactionType.WITHDRAWAL,
      query,
    );
  }

  /**
   * Get profits only
   * GET /transactions/profits
   */
  @Get('profits')
  async getProfits(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Omit<TransactionQueryDto, 'type'>,
  ) {
    return this.transactionsService.getTransactionsByType(
      user.id,
      TransactionType.PROFIT,
      query,
    );
  }

  /**
   * Get bonuses (referral + deposit bonuses)
   * GET /transactions/bonuses
   */
  @Get('bonuses')
  async getBonuses(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TransactionQueryDto,
  ) {
    const referralBonuses = await this.transactionsService.getTransactionsByType(
      user.id,
      TransactionType.REFERRAL_BONUS,
      query,
    );
    const depositBonuses = await this.transactionsService.getTransactionsByType(
      user.id,
      TransactionType.DEPOSIT_BONUS,
      query,
    );

    return {
      referralBonuses: referralBonuses.data,
      depositBonuses: depositBonuses.data,
    };
  }

  /**
   * Get team earnings (commissions + salary)
   * GET /transactions/team
   */
  @Get('team')
  async getTeamEarnings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TransactionQueryDto,
  ) {
    const commissions = await this.transactionsService.getTransactionsByType(
      user.id,
      TransactionType.TEAM_COMMISSION,
      query,
    );
    const salaries = await this.transactionsService.getTransactionsByType(
      user.id,
      TransactionType.WEEKLY_SALARY,
      query,
    );

    return {
      commissions: commissions.data,
      weeklySalaries: salaries.data,
    };
  }

  /**
   * Get single transaction by ID
   * GET /transactions/:id
   */
  @Get(':id')
  async getTransactionById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.transactionsService.getTransactionById(user.id, id);
  }
}
