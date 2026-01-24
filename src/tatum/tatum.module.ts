import { Module } from '@nestjs/common';
import { TatumService } from './tatum.service';

@Module({
  providers: [TatumService],
  exports: [TatumService],
})
export class TatumModule {}
