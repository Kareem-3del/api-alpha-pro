import { Module } from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { DepositsController } from './deposits.controller';
import { WebhookController } from './webhook.controller';
import { WalletPoolService } from './wallet-pool.service';
import { TatumModule } from '../tatum/tatum.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [TatumModule, EmailModule],
  controllers: [DepositsController, WebhookController],
  providers: [DepositsService, WalletPoolService],
  exports: [DepositsService, WalletPoolService],
})
export class DepositsModule {}
