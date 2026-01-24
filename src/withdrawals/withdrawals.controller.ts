import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateWithdrawalDto } from './dto/withdrawal.dto';
import type { AuthenticatedUser } from '../common/types/user.type';

@Controller('withdrawals')
@UseGuards(JwtAuthGuard)
export class WithdrawalsController {
  constructor(private withdrawalsService: WithdrawalsService) {}

  @Post()
  async createWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() createWithdrawalDto: CreateWithdrawalDto,
  ) {
    return this.withdrawalsService.createWithdrawal(
      user.id,
      createWithdrawalDto,
    );
  }

  @Get('history')
  async getWithdrawalHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.withdrawalsService.getWithdrawalHistory(user.id);
  }

  @Get('fees')
  calculateFees(
    @Query('amount') amount: string,
    @Query('network') network: 'BEP20' | 'TRC20',
  ) {
    return this.withdrawalsService.calculateFees(Number(amount), network);
  }

  @Post(':id/process')
  async processWithdrawal(@Param('id') id: string) {
    return this.withdrawalsService.processWithdrawal(id);
  }
}
