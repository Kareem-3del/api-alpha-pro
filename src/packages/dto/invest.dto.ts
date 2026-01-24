import { IsNotEmpty, IsString, IsNumber, Min } from 'class-validator';

export class InvestDto {
  @IsString()
  @IsNotEmpty()
  packageId: string;

  @IsNumber()
  @Min(100)
  amount: number;
}
