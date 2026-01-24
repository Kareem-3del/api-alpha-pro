import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PackagesModule } from './packages/packages.module';
import { WalletModule } from './wallet/wallet.module';
import { DepositsModule } from './deposits/deposits.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
import { ReferralsModule } from './referrals/referrals.module';
import { ProfitsModule } from './profits/profits.module';
import { TeamModule } from './team/team.module';
import { EmailModule } from './email/email.module';
import { TatumModule } from './tatum/tatum.module';
import { AdminModule } from './admin/admin.module';
import { PricesModule } from './prices/prices.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    PackagesModule,
    WalletModule,
    DepositsModule,
    WithdrawalsModule,
    ReferralsModule,
    ProfitsModule,
    TeamModule,
    EmailModule,
    TatumModule,
    AdminModule,
    PricesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
