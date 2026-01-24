import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { PackagesService } from './packages.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { InvestDto } from './dto/invest.dto';
import type { AuthenticatedUser } from '../common/types/user.type';

@Controller('packages')
export class PackagesController {
  constructor(private packagesService: PackagesService) {}

  @Get()
  async findAll() {
    return this.packagesService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.packagesService.findOne(id);
  }

  @Post('invest')
  @UseGuards(JwtAuthGuard)
  async invest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() investDto: InvestDto,
  ) {
    return this.packagesService.invest(user.id, investDto);
  }

  @Get('user/investments')
  @UseGuards(JwtAuthGuard)
  async getUserInvestments(@CurrentUser() user: AuthenticatedUser) {
    return this.packagesService.getUserInvestments(user.id);
  }

  @Get('user/active')
  @UseGuards(JwtAuthGuard)
  async getActiveInvestments(@CurrentUser() user: AuthenticatedUser) {
    return this.packagesService.getActiveInvestments(user.id);
  }

  @Post('seed')
  async seedPackages() {
    return this.packagesService.seedPackages();
  }
}
