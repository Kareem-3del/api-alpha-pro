import { Controller, Get, UseGuards } from '@nestjs/common';
import { TeamService } from './team.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/user.type';

@Controller('team')
@UseGuards(JwtAuthGuard)
export class TeamController {
  constructor(private teamService: TeamService) {}

  @Get('earnings')
  async getTeamEarnings(@CurrentUser() user: AuthenticatedUser) {
    return this.teamService.getTeamEarnings(user.id);
  }

  @Get('levels')
  async getTeamLevels(@CurrentUser() user: AuthenticatedUser) {
    return this.teamService.getTeamLevels(user.id);
  }

  @Get('salary')
  async getWeeklySalaryInfo(@CurrentUser() user: AuthenticatedUser) {
    return this.teamService.getWeeklySalaryInfo(user.id);
  }
}
