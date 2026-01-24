import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TatumSDK, Network } from '@tatumio/tatum';

// Tatum SDK types are dynamic, so we use a generic interface
interface TatumSdkInstance {
  wallet: {
    generateAddressFromXpub: (xpub: string, index: number) => Promise<string>;
    generatePrivateKeyFromMnemonic: (
      mnemonic: string,
      index: number,
    ) => Promise<string>;
    generateWallet: () => Promise<{ mnemonic: string; xpub: string }>;
  };
  address: {
    getBalance: (params: {
      addresses: string[];
    }) => Promise<Array<{ balance: string }>>;
  };
  token: {
    getBalance: (params: {
      addresses: string[];
      tokenAddress: string;
    }) => Promise<Array<{ balance: string }>>;
    send: (params: {
      to: string;
      amount: string;
      contractAddress: string;
      fromPrivateKey: string;
    }) => Promise<{ txId: string }>;
  };
  notification: {
    subscribe: {
      addressEvent: (params: {
        address: string;
        url: string;
      }) => Promise<{ id: string }>;
    };
  };
  rpc: {
    getTransactionByHash: (txHash: string) => Promise<unknown>;
  };
  destroy: () => Promise<void>;
}

@Injectable()
export class TatumService {
  private readonly logger = new Logger(TatumService.name);
  private bscSdk: TatumSdkInstance | null = null;

  constructor(private configService: ConfigService) {
    void this.initializeSdk();
  }

  private async initializeSdk() {
    try {
      const isTestnet =
        this.configService.get<string>('TATUM_TESTNET') === 'true';

      // Use string literals for network as Tatum SDK types may vary
      const sdk = await TatumSDK.init({
        network: isTestnet
          ? Network.BINANCE_SMART_CHAIN_TESTNET
          : Network.BINANCE_SMART_CHAIN,
        apiKey: {
          v4: this.configService.get<string>('TATUM_API_KEY'),
        },
      });
      this.bscSdk = sdk as unknown as TatumSdkInstance;

      this.logger.log('Tatum SDK initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Tatum SDK', error);
    }
  }

  private ensureSdkInitialized(): TatumSdkInstance {
    if (!this.bscSdk) {
      throw new Error('Tatum SDK not initialized');
    }
    return this.bscSdk;
  }

  async generateBscAddress(
    index: number,
  ): Promise<{ address: string; privateKey: string }> {
    try {
      const sdk = this.ensureSdkInitialized();
      const xpub = this.configService.get<string>('BSC_XPUB') || '';
      const mnemonic = this.configService.get<string>('BSC_MNEMONIC') || '';

      // Generate address from xpub
      const address = await sdk.wallet.generateAddressFromXpub(xpub, index);

      // Generate private key from mnemonic
      const privateKey = await sdk.wallet.generatePrivateKeyFromMnemonic(
        mnemonic,
        index,
      );

      return { address, privateKey };
    } catch (error) {
      this.logger.error('Failed to generate BSC address', error);
      throw error;
    }
  }

  async generateWallet(): Promise<{ mnemonic: string; xpub: string }> {
    try {
      const sdk = this.ensureSdkInitialized();
      const wallet = await sdk.wallet.generateWallet();
      return {
        mnemonic: wallet.mnemonic,
        xpub: wallet.xpub,
      };
    } catch (error) {
      this.logger.error('Failed to generate wallet', error);
      throw error;
    }
  }

  async getBalance(address: string): Promise<string> {
    try {
      const sdk = this.ensureSdkInitialized();
      const balance = await sdk.address.getBalance({
        addresses: [address],
      });
      return balance[0]?.balance || '0';
    } catch (error) {
      this.logger.error('Failed to get balance', error);
      throw error;
    }
  }

  async getUsdtBalance(address: string): Promise<string> {
    try {
      const sdk = this.ensureSdkInitialized();
      // USDT contract address on BSC
      const usdtContract = '0x55d398326f99059fF775485246999027B3197955';

      const balance = await sdk.token.getBalance({
        addresses: [address],
        tokenAddress: usdtContract,
      });

      return balance[0]?.balance || '0';
    } catch (error) {
      this.logger.error('Failed to get USDT balance', error);
      throw error;
    }
  }

  async sendUsdt(
    fromPrivateKey: string,
    toAddress: string,
    amount: string,
  ): Promise<{ txId: string }> {
    try {
      const sdk = this.ensureSdkInitialized();
      // USDT contract address on BSC (BEP20)
      const usdtContract = '0x55d398326f99059fF775485246999027B3197955';

      const tx = await sdk.token.send({
        to: toAddress,
        amount,
        contractAddress: usdtContract,
        fromPrivateKey,
      });

      return { txId: tx.txId };
    } catch (error) {
      this.logger.error('Failed to send USDT', error);
      throw error;
    }
  }

  async createWebhook(address: string, url: string): Promise<string> {
    try {
      const sdk = this.ensureSdkInitialized();
      const webhook = await sdk.notification.subscribe.addressEvent({
        address,
        url,
      });

      return webhook.id;
    } catch (error) {
      this.logger.error('Failed to create webhook', error);
      throw error;
    }
  }

  async getTransactionDetails(txHash: string): Promise<unknown> {
    try {
      const sdk = this.ensureSdkInitialized();
      const tx = await sdk.rpc.getTransactionByHash(txHash);
      return tx;
    } catch (error) {
      this.logger.error('Failed to get transaction details', error);
      throw error;
    }
  }

  async destroy() {
    if (this.bscSdk) {
      await this.bscSdk.destroy();
    }
  }
}
