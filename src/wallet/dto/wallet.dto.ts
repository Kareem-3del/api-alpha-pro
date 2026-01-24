import { IsNotEmpty, IsString, IsEnum } from 'class-validator';

export enum WalletNetwork {
  BEP20 = 'BEP20',
  TRC20 = 'TRC20',
}

export class LinkWalletDto {
  @IsString()
  @IsNotEmpty()
  address: string;

  @IsEnum(WalletNetwork)
  network: WalletNetwork;
}

export class VerifyWalletDto {
  @IsString()
  @IsNotEmpty()
  code: string;
}

export class UpdateWalletDto {
  @IsString()
  @IsNotEmpty()
  address: string;

  @IsEnum(WalletNetwork)
  network: WalletNetwork;
}
