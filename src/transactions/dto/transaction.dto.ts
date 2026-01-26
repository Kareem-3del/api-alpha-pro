import { IsOptional, IsEnum, IsDateString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { TransactionType, TransactionStatus } from '@prisma/client';

export class TransactionQueryDto {
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  sortBy?: 'createdAt' | 'amount' = 'createdAt';

  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}

export class TransactionResponseDto {
  id: string;
  type: TransactionType;
  amount: number;
  fee: number;
  netAmount: number;
  status: TransactionStatus;
  reference: string | null;
  description: string | null;
  createdAt: Date;
}

export class TransactionStatsDto {
  totalDeposits: number;
  totalWithdrawals: number;
  totalProfits: number;
  totalReferralBonuses: number;
  totalTeamCommissions: number;
  totalWeeklySalaries: number;
  totalDepositBonuses: number;
  pendingTransactions: number;
  netBalance: number;
}

export class PaginatedTransactionsDto {
  data: TransactionResponseDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
