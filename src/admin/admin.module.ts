import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { DepositsModule } from '../deposits/deposits.module';

@Module({
  imports: [DepositsModule],
  controllers: [AdminController],
})
export class AdminModule {}
