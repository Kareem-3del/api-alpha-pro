import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TatumSDK, Network } from '@tatumio/tatum';
import { ethers } from 'ethers';
import { TronWeb } from 'tronweb';

// Tatum SDK v4 interface (wallet methods removed - using ethers directly)
interface TatumSdkInstance {
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
  private tronSdk: TatumSdkInstance | null = null;

  constructor(private configService: ConfigService) {
    void this.initializeSdks();
  }

  private async initializeSdks() {
    const isTestnet =
      this.configService.get<string>('TATUM_TESTNET') === 'true';
    const apiKey = this.configService.get<string>('TATUM_API_KEY');

    // Initialize BSC SDK
    try {
      const sdk = await TatumSDK.init({
        network: isTestnet
          ? Network.BINANCE_SMART_CHAIN_TESTNET
          : Network.BINANCE_SMART_CHAIN,
        apiKey: { v4: apiKey },
      });
      this.bscSdk = sdk as unknown as TatumSdkInstance;
      this.logger.log('Tatum BSC SDK initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Tatum BSC SDK', error);
    }

    // Initialize TRON SDK
    try {
      const sdk = await TatumSDK.init({
        network: isTestnet
          ? Network.TRON_SHASTA
          : Network.TRON,
        apiKey: { v4: apiKey },
      });
      this.tronSdk = sdk as unknown as TatumSdkInstance;
      this.logger.log('Tatum TRON SDK initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Tatum TRON SDK', error);
    }
  }

  private ensureSdkInitialized(): TatumSdkInstance {
    if (!this.bscSdk) {
      throw new Error('Tatum BSC SDK not initialized');
    }
    return this.bscSdk;
  }

  private ensureTronSdkInitialized(): TatumSdkInstance {
    if (!this.tronSdk) {
      throw new Error('Tatum TRON SDK not initialized');
    }
    return this.tronSdk;
  }

  async generateBscAddress(
    index: number,
  ): Promise<{ address: string; privateKey: string }> {
    try {
      const xpub = this.configService.get<string>('BSC_XPUB') || '';
      const mnemonic = this.configService.get<string>('BSC_MNEMONIC') || '';

      // Generate address from xpub using ethers HD node
      const xpubNode = ethers.utils.HDNode.fromExtendedKey(xpub);
      const addressChild = xpubNode.derivePath(`0/${index}`);
      const address = addressChild.address;

      // Generate private key from mnemonic using BIP44 path
      const hdNode = ethers.utils.HDNode.fromMnemonic(mnemonic);
      const derived = hdNode.derivePath(`m/44'/60'/0'/0/${index}`);
      const privateKey = derived.privateKey;

      // Verify address/key match
      if (address.toLowerCase() !== derived.address.toLowerCase()) {
        throw new Error(
          `Address mismatch: xpub=${address}, mnemonic=${derived.address}`,
        );
      }

      return { address, privateKey };
    } catch (error) {
      this.logger.error('Failed to generate BSC address', error);
      throw error;
    }
  }

  async generateTronAddress(
    index: number,
  ): Promise<{ address: string; privateKey: string }> {
    try {
      const mnemonic = this.configService.get<string>('BSC_MNEMONIC') || '';

      // TRON uses BIP44 coin type 195: m/44'/195'/0'/0/{index}
      const hdNode = ethers.utils.HDNode.fromMnemonic(mnemonic);
      const derived = hdNode.derivePath(`m/44'/195'/0'/0/${index}`);
      const privateKeyHex = derived.privateKey.replace('0x', '');

      // Convert ETH-style private key to TRON address
      const tronWeb = new TronWeb({ fullHost: 'https://api.trongrid.io' });
      const address = tronWeb.address.fromPrivateKey(privateKeyHex);

      if (!address) {
        throw new Error('Failed to derive TRON address from private key');
      }

      return { address, privateKey: privateKeyHex };
    } catch (error) {
      this.logger.error('Failed to generate TRON address', error);
      throw error;
    }
  }

  async generateWallet(): Promise<{ mnemonic: string; xpub: string }> {
    try {
      const wallet = ethers.utils.HDNode.fromMnemonic(
        ethers.utils.entropyToMnemonic(ethers.utils.randomBytes(32)),
      );
      const accountNode = wallet.derivePath("m/44'/60'/0'");
      return {
        mnemonic: wallet.mnemonic!.phrase,
        xpub: accountNode.neuter().extendedKey,
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

  async createWebhook(address: string, url: string, network?: 'BEP20' | 'TRC20'): Promise<string> {
    try {
      // Determine which SDK to use based on network or address format
      const isTron = network === 'TRC20' || (!network && !address.startsWith('0x'));
      const sdk = isTron ? this.ensureTronSdkInitialized() : this.ensureSdkInitialized();

      const result = await sdk.notification.subscribe.addressEvent({
        address,
        url,
      }) as any;

      // Tatum SDK v4 returns { data: { id }, status, error }
      const webhookId = result?.data?.id || result?.id;

      // Handle "subscription already exists" - extract ID from error message
      if (!webhookId && result?.error?.code === 'subscription.exists.on.address-and-currency') {
        const match = result.error.message?.[0]?.match(/\(([a-f0-9]{24})\)/);
        if (match) {
          this.logger.log(`${isTron ? 'TRON' : 'BSC'} webhook already exists for ${address}: ${match[1]}`);
          return match[1];
        }
      }

      if (!webhookId) {
        this.logger.warn(`Webhook creation returned unexpected result for ${address}: ${JSON.stringify(result)}`);
        throw new Error('No webhook ID returned from Tatum');
      }

      this.logger.log(`Created ${isTron ? 'TRON' : 'BSC'} webhook ${webhookId} for ${address}`);
      return webhookId;
    } catch (error) {
      this.logger.error(`Failed to create webhook for ${address}`, error);
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
    if (this.tronSdk) {
      await this.tronSdk.destroy();
    }
  }
}
