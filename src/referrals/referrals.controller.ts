import { Controller, Get, UseGuards } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/user.type';

@Controller('referrals')
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(private referralsService: ReferralsService) {}

  @Get('code')
  async getReferralCode(@CurrentUser() user: AuthenticatedUser) {
    return this.referralsService.getReferralCode(user.id);
  }

  @Get()
  async getReferrals(@CurrentUser() user: AuthenticatedUser) {
    return this.referralsService.getReferrals(user.id);
  }

  @Get('stats')
  async getReferralStats(@CurrentUser() user: AuthenticatedUser) {
    return this.referralsService.getReferralStats(user.id);
  }

  @Get('tree')
  async getTeamTree(@CurrentUser() user: AuthenticatedUser) {
    return this.referralsService.getTeamTree(user.id);
  }
}
