import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ProfitsService } from './profits.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/user.type';

@Controller('profits')
@UseGuards(JwtAuthGuard)
export class ProfitsController {
  constructor(private profitsService: ProfitsService) {}

  @Get('history')
  async getProfitHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.profitsService.getProfitHistory(user.id);
  }

  @Get('team-bonuses')
  async getTeamBonusHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.profitsService.getTeamBonusHistory(user.id);
  }

  @Get('weekly-salary')
  async getWeeklySalaryHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.profitsService.getWeeklySalaryHistory(user.id);
  }

  // Admin endpoints for testing - protected with AdminGuard
  @Post('trigger/daily')
  @UseGuards(AdminGuard)
  async triggerDailyProfits() {
    return this.profitsService.triggerDailyProfits();
  }

  @Post('trigger/weekly')
  @UseGuards(AdminGuard)
  async triggerWeeklySalary() {
    return this.profitsService.triggerWeeklySalary();
  }

  // TESTING: Cleanup testing data (remove after testing)
  @Post('cleanup-testing')
  @UseGuards(AdminGuard)
  async cleanupTestingData() {
    return this.profitsService.cleanupTestingData();
  }
}
