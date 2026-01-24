import { IsEnum, IsNumber, Min } from 'class-validator';

export enum WalletNetwork {
  BEP20 = 'BEP20',
  TRC20 = 'TRC20',
}

export class CreateDepositDto {
  @IsNumber()
  @Min(100)
  amount: number;

  @IsEnum(WalletNetwork)
  network: WalletNetwork;
}
