import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TatumService } from '../tatum/tatum.service';
import { WalletNetwork } from '@prisma/client';
import { encrypt, decrypt } from '../common/utils/crypto.util';
import { utils as ethersUtils } from 'ethers';
import { TronWeb } from 'tronweb';

// Wallet assignment duration in milliseconds (1 hour)
const WALLET_ASSIGNMENT_DURATION = 60 * 60 * 1000;

@Injectable()
export class WalletPoolService {
  private readonly logger = new Logger(WalletPoolService.name);

  constructor(
    private prisma: PrismaService,
    private tatumService: TatumService,
    private configService: ConfigService,
  ) {}

  /**
   * Get or assign a deposit wallet to a user
   * If user already has an active assignment, return it
   * Otherwise, find an available wallet or generate a new one
   */
  async getOrAssignWallet(
    userId: string,
    network: WalletNetwork,
  ): Promise<{
    address: string;
    expiresAt: Date;
    isNew: boolean;
  }> {
    // Check if user already has an active wallet assignment
    const existingAssignment = await this.prisma.depositWallet.findFirst({
      where: {
        assignedToUserId: userId,
        network,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (existingAssignment) {
      // Ensure webhook exists for this wallet
      if (!existingAssignment.webhookId) {
        await this.ensureWebhook(existingAssignment.id, existingAssignment.address, network);
      }

      this.logger.log(
        `User ${userId} already has wallet assigned: ${existingAssignment.address}`,
      );
      return {
        address: existingAssignment.address,
        expiresAt: existingAssignment.expiresAt!,
        isNew: false,
      };
    }

    // Try to find an available wallet from the pool
    const availableWallet = await this.prisma.depositWallet.findFirst({
      where: {
        network,
        isAvailable: true,
      },
      orderBy: {
        lastUsedAt: 'asc', // Use least recently used wallet
      },
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + WALLET_ASSIGNMENT_DURATION);

    if (availableWallet) {
      // Ensure webhook exists for this wallet
      if (!availableWallet.webhookId) {
        await this.ensureWebhook(availableWallet.id, availableWallet.address, network);
      }

      // Assign the available wallet to the user
      await this.prisma.depositWallet.update({
        where: { id: availableWallet.id },
        data: {
          assignedToUserId: userId,
          assignedAt: now,
          expiresAt,
          isAvailable: false,
        },
      });

      this.logger.log(
        `Assigned existing wallet ${availableWallet.address} to user ${userId}`,
      );

      return {
        address: availableWallet.address,
        expiresAt,
        isNew: false,
      };
    }

    // No available wallet, generate a new one
    const newWallet = await this.generateNewWallet(network);

    // Assign to user
    await this.prisma.depositWallet.update({
      where: { id: newWallet.id },
      data: {
        assignedToUserId: userId,
        assignedAt: now,
        expiresAt,
        isAvailable: false,
      },
    });

    this.logger.log(
      `Generated and assigned new wallet ${newWallet.address} to user ${userId}`,
    );

    return {
      address: newWallet.address,
      expiresAt,
      isNew: true,
    };
  }

  /**
   * Generate a new wallet and add it to the pool
   */
  private async generateNewWallet(network: WalletNetwork) {
    // Get the next derivation index
    const lastWallet = await this.prisma.depositWallet.findFirst({
      where: { network },
      orderBy: { derivationIndex: 'desc' },
    });

    const nextIndex = lastWallet ? lastWallet.derivationIndex + 1 : 0;

    // Generate wallet address based on network
    let address: string;
    let privateKey: string;

    // Check if we're in test mode (no real Tatum API key)
    const tatumKey = this.configService.get<string>('TATUM_API_KEY');
    const bscMnemonic = this.configService.get<string>('BSC_MNEMONIC');
    const isTestMode = tatumKey?.includes('your-') ||
                       !bscMnemonic ||
                       bscMnemonic?.includes('your-');

    if (isTestMode) {
      // Generate test addresses for development
      const crypto = require('crypto');
      const randomBytes = crypto.randomBytes(20).toString('hex');
      address = network === WalletNetwork.BEP20
        ? `0x${randomBytes}`
        : `T${randomBytes.substring(0, 33).toUpperCase()}`;
      privateKey = crypto.randomBytes(32).toString('hex');
      this.logger.warn(`Test mode: Generated mock ${network} address ${address}`);
    } else if (network === WalletNetwork.BEP20) {
      const result = await this.tatumService.generateBscAddress(nextIndex);
      address = result.address;
      privateKey = result.privateKey;
    } else {
      // TRC20 - TRON wallet generation
      const result = await this.tatumService.generateTronAddress(nextIndex);
      address = result.address;
      privateKey = result.privateKey;
    }

    // Verify address matches private key
    if (network === WalletNetwork.BEP20) {
      const keyWithPrefix = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;
      const derivedAddress = ethersUtils.computeAddress(keyWithPrefix);
      if (derivedAddress.toLowerCase() !== address.toLowerCase()) {
        this.logger.error(
          `BEP20 address mismatch! Expected: ${address}, Got: ${derivedAddress}`,
        );
        throw new Error('BEP20 wallet address/key mismatch - check BSC_XPUB and BSC_MNEMONIC configuration');
      }
    } else if (network === WalletNetwork.TRC20) {
      const tronWeb = new TronWeb({ fullHost: 'https://api.trongrid.io' });
      const keyHex = privateKey.replace('0x', '');
      const derivedAddress = tronWeb.address.fromPrivateKey(keyHex);
      if (!derivedAddress || derivedAddress !== address) {
        this.logger.error(
          `TRC20 address mismatch! Expected: ${address}, Got: ${derivedAddress}`,
        );
        throw new Error('TRC20 wallet address/key mismatch - check BSC_MNEMONIC configuration');
      }
    }

    // Subscribe to webhook for this address
    const webhookUrl = this.configService.get<string>('WEBHOOK_URL');
    let webhookId: string | null = null;

    if (webhookUrl) {
      try {
        webhookId = await this.tatumService.createWebhook(address, webhookUrl, network);
        this.logger.log(`Created webhook ${webhookId} for address ${address}`);
      } catch (error) {
        this.logger.warn(
          `Failed to create webhook for ${address}: ${error.message}`,
        );
      }
    }

    // Encrypt private key before storing
    const encryptionSecret = this.configService.get<string>('ENCRYPTION_SECRET');
    if (!encryptionSecret) {
      throw new Error('ENCRYPTION_SECRET not configured');
    }
    const encryptedPrivateKey = encrypt(privateKey, encryptionSecret);

    // Save wallet to pool
    const wallet = await this.prisma.depositWallet.create({
      data: {
        address,
        privateKey: encryptedPrivateKey,
        network,
        derivationIndex: nextIndex,
        webhookId,
        isAvailable: true,
      },
    });

    this.logger.log(
      `Generated new ${network} wallet: ${address} (index: ${nextIndex})`,
    );

    return wallet;
  }

  /**
   * Get decrypted private key for a wallet (admin only)
   */
  getDecryptedPrivateKey(encryptedKey: string): string {
    const encryptionSecret = this.configService.get<string>('ENCRYPTION_SECRET');
    if (!encryptionSecret) {
      throw new Error('ENCRYPTION_SECRET not configured');
    }
    return decrypt(encryptedKey, encryptionSecret);
  }

  /**
   * Ensure a Tatum webhook exists for a wallet address
   */
  private async ensureWebhook(walletId: string, address: string, network?: WalletNetwork) {
    const webhookUrl = this.configService.get<string>('WEBHOOK_URL');
    if (!webhookUrl) return;

    try {
      const webhookId = await this.tatumService.createWebhook(address, webhookUrl, network);
      await this.prisma.depositWallet.update({
        where: { id: walletId },
        data: { webhookId },
      });
      this.logger.log(`Created missing webhook ${webhookId} for address ${address}`);
    } catch (error) {
      this.logger.warn(`Failed to create webhook for ${address}: ${error.message}`);
    }
  }

  /**
   * Find wallet by address
   */
  async findWalletByAddress(address: string) {
    return this.prisma.depositWallet.findUnique({
      where: { address },
    });
  }

  /**
   * Release a wallet back to the pool
   */
  async releaseWallet(walletId: string) {
    await this.prisma.depositWallet.update({
      where: { id: walletId },
      data: {
        assignedToUserId: null,
        assignedAt: null,
        expiresAt: null,
        isAvailable: true,
        lastUsedAt: new Date(),
      },
    });

    this.logger.log(`Released wallet ${walletId} back to pool`);
  }

  /**
   * Mark wallet as used (increment usage counter)
   */
  async markWalletUsed(walletId: string) {
    await this.prisma.depositWallet.update({
      where: { id: walletId },
      data: {
        totalDeposits: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
  }

  /**
   * Cron job to release expired wallet assignments
   * Runs every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async releaseExpiredWallets() {
    const now = new Date();

    const expiredWallets = await this.prisma.depositWallet.findMany({
      where: {
        isAvailable: false,
        expiresAt: {
          lt: now,
        },
      },
    });

    if (expiredWallets.length === 0) {
      return;
    }

    this.logger.log(`Releasing ${expiredWallets.length} expired wallets`);

    // Also cancel any pending deposits for these wallets
    for (const wallet of expiredWallets) {
      // Cancel pending deposits for this wallet
      await this.prisma.deposit.updateMany({
        where: {
          depositAddress: wallet.address,
          status: 'PENDING',
          expiresAt: {
            lt: now,
          },
        },
        data: {
          status: 'CANCELLED',
        },
      });
    }

    // Release all expired wallets
    await this.prisma.depositWallet.updateMany({
      where: {
        id: {
          in: expiredWallets.map((w) => w.id),
        },
      },
      data: {
        assignedToUserId: null,
        assignedAt: null,
        expiresAt: null,
        isAvailable: true,
        lastUsedAt: now,
      },
    });

    this.logger.log(`Released ${expiredWallets.length} expired wallets`);
  }

  /**
   * Get pool statistics
   */
  async getPoolStats() {
    const [total, available, assigned] = await Promise.all([
      this.prisma.depositWallet.count(),
      this.prisma.depositWallet.count({ where: { isAvailable: true } }),
      this.prisma.depositWallet.count({ where: { isAvailable: false } }),
    ]);

    return {
      total,
      available,
      assigned,
    };
  }

  // ==================== ADMIN METHODS ====================

  /**
   * Get all wallets for admin dashboard
   */
  async getAllWallets(network?: WalletNetwork) {
    const where = network ? { network } : {};

    return this.prisma.depositWallet.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        address: true,
        network: true,
        derivationIndex: true,
        isAvailable: true,
        assignedToUserId: true,
        assignedAt: true,
        expiresAt: true,
        totalDeposits: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Get wallet with decrypted private key (admin only)
   */
  async getWalletWithPrivateKey(walletId: string) {
    const wallet = await this.prisma.depositWallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      return null;
    }

    return {
      ...wallet,
      decryptedPrivateKey: this.getDecryptedPrivateKey(wallet.privateKey),
    };
  }

  /**
   * Get wallet balance from blockchain
   */
  async getWalletBalance(address: string, network: WalletNetwork) {
    try {
      if (network === WalletNetwork.BEP20) {
        const [bnbBalance, usdtBalance] = await Promise.all([
          this.tatumService.getBalance(address),
          this.tatumService.getUsdtBalance(address),
        ]);
        return {
          address,
          network,
          nativeBalance: bnbBalance, // BNB for gas
          usdtBalance,
        };
      } else {
        // TRC20 - placeholder for now
        return {
          address,
          network,
          nativeBalance: '0',
          usdtBalance: '0',
        };
      }
    } catch (error) {
      this.logger.error(`Failed to get balance for ${address}: ${error.message}`);
      return {
        address,
        network,
        nativeBalance: '0',
        usdtBalance: '0',
        error: error.message,
      };
    }
  }

  /**
   * Transfer USDT from deposit wallet to master wallet
   * Steps:
   * 1. Check USDT balance in deposit wallet
   * 2. If needed, send gas (BNB/TRX) from master to deposit wallet
   * 3. Send all USDT from deposit wallet to master
   */
  async transferToMaster(walletId: string) {
    const wallet = await this.prisma.depositWallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    const masterAddress =
      wallet.network === WalletNetwork.BEP20
        ? this.configService.get<string>('BSC_MASTER_ADDRESS')
        : this.configService.get<string>('TRON_MASTER_ADDRESS');

    if (!masterAddress) {
      throw new Error(`Master address not configured for ${wallet.network}`);
    }

    // Get decrypted private key
    const privateKey = this.getDecryptedPrivateKey(wallet.privateKey);

    // Get current balance
    const balance = await this.getWalletBalance(wallet.address, wallet.network);
    const usdtAmount = parseFloat(balance.usdtBalance);

    if (usdtAmount <= 0) {
      throw new Error('No USDT balance to transfer');
    }

    this.logger.log(
      `Transferring ${usdtAmount} USDT from ${wallet.address} to master ${masterAddress}`,
    );

    // For BEP20, send the USDT
    if (wallet.network === WalletNetwork.BEP20) {
      const result = await this.tatumService.sendUsdt(
        privateKey,
        masterAddress,
        usdtAmount.toString(),
      );

      this.logger.log(`Transfer complete: ${result.txId}`);

      return {
        success: true,
        txId: result.txId,
        amount: usdtAmount,
        from: wallet.address,
        to: masterAddress,
      };
    }

    // TRC20 - not implemented yet
    throw new Error('TRC20 transfer not implemented');
  }
}
