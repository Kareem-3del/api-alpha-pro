import { Controller, Get, Param, Query } from '@nestjs/common';
import { PricesService } from './prices.service';

@Controller('prices')
export class PricesController {
  constructor(private readonly pricesService: PricesService) {}

  @Get()
  async getPrices(
    @Query('coins') coins?: string,
    @Query('currency') currency?: string,
  ) {
    const coinList = coins ? coins.split(',') : undefined;
    return this.pricesService.getPrices(coinList, currency);
  }

  @Get('global')
  async getGlobalMarketData() {
    return this.pricesService.getGlobalMarketData();
  }

  @Get('search')
  async searchCoins(@Query('q') query: string) {
    return this.pricesService.searchCoins(query);
  }

  @Get(':coinId')
  async getCoinDetails(
    @Param('coinId') coinId: string,
    @Query('currency') currency?: string,
  ) {
    return this.pricesService.getCoinDetails(coinId, currency);
  }
}
