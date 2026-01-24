import { Controller, Get, Post, Put, Body, UseGuards } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  LinkWalletDto,
  VerifyWalletDto,
  UpdateWalletDto,
} from './dto/wallet.dto';
import type { AuthenticatedUser } from '../common/types/user.type';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private walletService: WalletService) {}

  @Get()
  async getWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.getWallet(user.id);
  }

  @Post('link')
  async requestLinkWallet(
    @CurrentUser() user: AuthenticatedUser,
    @Body() linkWalletDto: LinkWalletDto,
  ) {
    return this.walletService.requestLinkWallet(user.id, linkWalletDto);
  }

  @Post('verify-link')
  async verifyAndLinkWallet(
    @CurrentUser() user: AuthenticatedUser,
    @Body() verifyDto: VerifyWalletDto,
  ) {
    return this.walletService.verifyAndLinkWallet(user.id, verifyDto);
  }

  @Put('change')
  async requestChangeWallet(
    @CurrentUser() user: AuthenticatedUser,
    @Body() updateDto: UpdateWalletDto,
  ) {
    return this.walletService.requestChangeWallet(user.id, updateDto);
  }

  @Post('verify-change')
  async verifyAndChangeWallet(
    @CurrentUser() user: AuthenticatedUser,
    @Body() verifyDto: VerifyWalletDto,
  ) {
    return this.walletService.verifyAndChangeWallet(user.id, verifyDto);
  }
}
