import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { DepositsModule } from '../deposits/deposits.module';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';

@Module({
  imports: [DepositsModule, WithdrawalsModule],
  controllers: [AdminController],
})
export class AdminModule {}
