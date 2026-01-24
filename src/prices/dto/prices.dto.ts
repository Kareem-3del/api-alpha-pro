import { IsArray, IsOptional, IsString } from 'class-validator';

export class GetPricesDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  coins?: string[];

  @IsString()
  @IsOptional()
  currency?: string;
}

export interface CryptoPrice {
  id: string;
  symbol: string;
  name: string;
  image: string;
  currentPrice: number;
  marketCap: number;
  marketCapRank: number;
  priceChange24h: number;
  priceChangePercentage24h: number;
  high24h: number;
  low24h: number;
  totalVolume: number;
  circulatingSupply: number;
  totalSupply: number | null;
  lastUpdated: string;
}

export interface PriceHistoryPoint {
  timestamp: number;
  price: number;
}

export interface CoinDetails extends CryptoPrice {
  description: string;
  priceHistory7d: PriceHistoryPoint[];
  athPrice: number;
  athDate: string;
  atlPrice: number;
  atlDate: string;
}
