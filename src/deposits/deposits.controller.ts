import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateDepositDto } from './dto/deposit.dto';
import type { AuthenticatedUser } from '../common/types/user.type';

@Controller('deposits')
@UseGuards(JwtAuthGuard)
export class DepositsController {
  constructor(private depositsService: DepositsService) {}

  @Post()
  async createDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() createDepositDto: CreateDepositDto,
  ) {
    return this.depositsService.createDeposit(user.id, createDepositDto);
  }

  @Get('address')
  async getDepositAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Query('network') network: string,
  ) {
    return this.depositsService.getDepositAddress(user.id, network);
  }

  @Get('session')
  async getActiveDepositSession(
    @CurrentUser() user: AuthenticatedUser,
    @Query('network') network: string,
  ) {
    return this.depositsService.getActiveDepositSession(user.id, network);
  }

  @Get('history')
  async getDepositHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.depositsService.getDepositHistory(user.id);
  }

  @Get('pool-stats')
  async getPoolStats() {
    return this.depositsService.getPoolStats();
  }

  @Post(':id/confirm')
  async confirmDeposit(
    @Param('id') id: string,
    @Body('txHash') txHash: string,
  ) {
    return this.depositsService.confirmDeposit(id, txHash);
  }
}
