import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';
import { CryptoPrice, CoinDetails, PriceHistoryPoint } from './dto/prices.dto';

@Injectable()
export class PricesService {
  private readonly logger = new Logger(PricesService.name);
  private readonly COINGECKO_API = 'https://api.coingecko.com/api/v3';

  // Default coins to fetch
  private readonly DEFAULT_COINS = [
    'bitcoin',
    'ethereum',
    'tether',
    'binancecoin',
    'ripple',
    'solana',
    'cardano',
    'dogecoin',
    'tron',
    'polkadot',
  ];

  // Cache for rate limiting
  private pricesCache: { data: CryptoPrice[]; timestamp: number } | null = null;
  private readonly CACHE_TTL = 60000; // 1 minute cache

  constructor(private readonly httpService: HttpService) {}

  async getPrices(
    coins?: string[],
    currency: string = 'usd',
  ): Promise<CryptoPrice[]> {
    try {
      // Check cache
      if (
        this.pricesCache &&
        Date.now() - this.pricesCache.timestamp < this.CACHE_TTL
      ) {
        this.logger.debug('Returning cached prices');
        return this.pricesCache.data;
      }

      const coinIds = coins?.length ? coins : this.DEFAULT_COINS;
      const url = `${this.COINGECKO_API}/coins/markets`;

      const response: AxiosResponse<any[]> = await firstValueFrom(
        this.httpService.get(url, {
          params: {
            vs_currency: currency,
            ids: coinIds.join(','),
            order: 'market_cap_desc',
            per_page: 100,
            page: 1,
            sparkline: false,
            price_change_percentage: '24h',
          },
        }),
      );

      const prices: CryptoPrice[] = response.data.map((coin: any) => ({
        id: coin.id,
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        image: coin.image,
        currentPrice: coin.current_price,
        marketCap: coin.market_cap,
        marketCapRank: coin.market_cap_rank,
        priceChange24h: coin.price_change_24h,
        priceChangePercentage24h: coin.price_change_percentage_24h,
        high24h: coin.high_24h,
        low24h: coin.low_24h,
        totalVolume: coin.total_volume,
        circulatingSupply: coin.circulating_supply,
        totalSupply: coin.total_supply,
        lastUpdated: coin.last_updated,
      }));

      // Update cache
      this.pricesCache = {
        data: prices,
        timestamp: Date.now(),
      };

      return prices;
    } catch (error) {
      this.logger.error(`Failed to fetch prices: ${error.message}`);

      // Return cached data if available on error
      if (this.pricesCache) {
        this.logger.warn('Returning stale cache due to API error');
        return this.pricesCache.data;
      }

      throw new HttpException(
        'Failed to fetch cryptocurrency prices',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async getCoinDetails(
    coinId: string,
    currency: string = 'usd',
  ): Promise<CoinDetails> {
    try {
      // Fetch coin data and market chart in parallel
      const [coinResponse, chartResponse]: [AxiosResponse<any>, AxiosResponse<any>] = await Promise.all([
        firstValueFrom(
          this.httpService.get(`${this.COINGECKO_API}/coins/${coinId}`, {
            params: {
              localization: false,
              tickers: false,
              market_data: true,
              community_data: false,
              developer_data: false,
            },
          }),
        ),
        firstValueFrom(
          this.httpService.get(
            `${this.COINGECKO_API}/coins/${coinId}/market_chart`,
            {
              params: {
                vs_currency: currency,
                days: 7,
              },
            },
          ),
        ),
      ]);

      const coin = coinResponse.data;
      const marketData = coin.market_data;

      const priceHistory7d: PriceHistoryPoint[] = chartResponse.data.prices.map(
        (point: [number, number]) => ({
          timestamp: point[0],
          price: point[1],
        }),
      );

      return {
        id: coin.id,
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        image: coin.image?.large || '',
        description: coin.description?.en || '',
        currentPrice: marketData.current_price?.[currency] || 0,
        marketCap: marketData.market_cap?.[currency] || 0,
        marketCapRank: coin.market_cap_rank,
        priceChange24h: marketData.price_change_24h || 0,
        priceChangePercentage24h:
          marketData.price_change_percentage_24h || 0,
        high24h: marketData.high_24h?.[currency] || 0,
        low24h: marketData.low_24h?.[currency] || 0,
        totalVolume: marketData.total_volume?.[currency] || 0,
        circulatingSupply: marketData.circulating_supply || 0,
        totalSupply: marketData.total_supply,
        lastUpdated: marketData.last_updated,
        priceHistory7d,
        athPrice: marketData.ath?.[currency] || 0,
        athDate: marketData.ath_date?.[currency] || '',
        atlPrice: marketData.atl?.[currency] || 0,
        atlDate: marketData.atl_date?.[currency] || '',
      };
    } catch (error) {
      this.logger.error(`Failed to fetch coin details: ${error.message}`);
      throw new HttpException(
        `Failed to fetch details for ${coinId}`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async searchCoins(query: string): Promise<{ id: string; name: string; symbol: string }[]> {
    try {
      const response: AxiosResponse<any> = await firstValueFrom(
        this.httpService.get(`${this.COINGECKO_API}/search`, {
          params: { query },
        }),
      );

      return response.data.coins.slice(0, 20).map((coin: any) => ({
        id: coin.id,
        name: coin.name,
        symbol: coin.symbol.toUpperCase(),
      }));
    } catch (error) {
      this.logger.error(`Failed to search coins: ${error.message}`);
      throw new HttpException(
        'Failed to search cryptocurrencies',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async getGlobalMarketData(): Promise<{
    totalMarketCap: number;
    totalVolume24h: number;
    btcDominance: number;
    activeCryptocurrencies: number;
    marketCapChange24h: number;
  }> {
    try {
      const response: AxiosResponse<any> = await firstValueFrom(
        this.httpService.get(`${this.COINGECKO_API}/global`),
      );

      const data = response.data.data;
      return {
        totalMarketCap: data.total_market_cap?.usd || 0,
        totalVolume24h: data.total_volume?.usd || 0,
        btcDominance: data.market_cap_percentage?.btc || 0,
        activeCryptocurrencies: data.active_cryptocurrencies || 0,
        marketCapChange24h: data.market_cap_change_percentage_24h_usd || 0,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch global market data: ${error.message}`);
      throw new HttpException(
        'Failed to fetch global market data',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
