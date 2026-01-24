import { IsEnum, IsNumber, IsString, Min, Matches } from 'class-validator';

export enum WalletNetwork {
  BEP20 = 'BEP20',
  TRC20 = 'TRC20',
}

export class CreateWithdrawalDto {
  @IsNumber()
  @Min(5)
  amount: number;

  @IsEnum(WalletNetwork)
  network: WalletNetwork;

  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'PIN must be 4-6 digits' })
  pin: string;
}
