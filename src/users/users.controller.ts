import { Controller, Get, Post, Put, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/user.type';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('profile')
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    console.log('Profile controller called, user:', user?.id);
    return this.usersService.getProfile(user.id);
  }

  @Get('dashboard')
  async getDashboard(@CurrentUser() user: AuthenticatedUser) {
    console.log('Dashboard controller called, user:', user?.id);
    return this.usersService.getDashboard(user.id);
  }

  @Put('language')
  async updateLanguage(
    @CurrentUser() user: AuthenticatedUser,
    @Body('language') language: string,
  ) {
    return this.usersService.updateLanguage(user.id, language);
  }

  // ========== PIN Management Endpoints ==========

  @Get('pin/status')
  async getPinStatus(@CurrentUser() user: AuthenticatedUser) {
    const hasPin = await this.usersService.hasWithdrawalPin(user.id);
    return { hasPin };
  }

  @Post('pin/request-otp')
  async requestPinOtp(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.requestPinOtp(user.id);
  }

  @Post('pin/set')
  async setWithdrawalPin(
    @CurrentUser() user: AuthenticatedUser,
    @Body('pin') pin: string,
    @Body('otp') otp: string,
  ) {
    return this.usersService.setWithdrawalPin(user.id, pin, otp);
  }

  @Post('pin/change')
  async changeWithdrawalPin(
    @CurrentUser() user: AuthenticatedUser,
    @Body('currentPin') currentPin: string,
    @Body('newPin') newPin: string,
    @Body('otp') otp: string,
  ) {
    return this.usersService.changeWithdrawalPin(
      user.id,
      currentPin,
      newPin,
      otp,
    );
  }

  @Post('pin/reset')
  async resetWithdrawalPin(
    @CurrentUser() user: AuthenticatedUser,
    @Body('newPin') newPin: string,
    @Body('otp') otp: string,
  ) {
    return this.usersService.resetWithdrawalPin(user.id, newPin, otp);
  }

  @Post('pin/verify')
  async verifyWithdrawalPin(
    @CurrentUser() user: AuthenticatedUser,
    @Body('pin') pin: string,
  ) {
    const isValid = await this.usersService.verifyWithdrawalPin(user.id, pin);
    return { valid: isValid };
  }
}
