import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { WalletPoolService } from './wallet-pool.service';
import { Decimal } from '@prisma/client/runtime/library';
import * as crypto from 'crypto';

// Tatum webhook payload structure for address events
interface TatumWebhookPayload {
  subscriptionType: string;
  address: string;
  counterAddress?: string;
  txId: string;
  blockNumber: number;
  asset: string;
  amount: string;
  tokenId?: string;
  type?: string; // 'native' | 'token' | 'erc20' | 'bep20' | 'trc20'
}

@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private emailService: EmailService,
    private walletPoolService: WalletPoolService,
  ) {}

  /**
   * Tatum test ping endpoint (GET)
   * Tatum sends a GET request to verify the webhook URL is reachable
   */
  @Get('tatum')
  @HttpCode(HttpStatus.OK)
  handleTatumTestPing() {
    this.logger.log('Received Tatum test ping (GET)');
    return { status: 'ok' };
  }

  /**
   * Tatum webhook endpoint for incoming transactions
   * Called when a deposit is detected on a watched address
   */
  @Post('tatum')
  @HttpCode(HttpStatus.OK)
  async handleTatumWebhook(
    @Body() payload: TatumWebhookPayload,
    @Headers('x-payload-hash') payloadHash: string,
  ) {
    this.logger.log(`Received Tatum webhook: ${JSON.stringify(payload)}`);

    // Verify webhook signature (optional but recommended)
    const isValid = this.verifyWebhookSignature(payload, payloadHash);
    if (!isValid) {
      this.logger.warn('Invalid webhook signature');
      // Still return 200 to prevent retries, but log the warning
    }

    try {
      await this.processIncomingDeposit(payload);
      return { status: 'ok' };
    } catch (error) {
      this.logger.error(`Failed to process webhook: ${error.message}`, error.stack);
      // Return 200 to prevent Tatum from retrying indefinitely
      return { status: 'error', message: error.message };
    }
  }

  /**
   * Verify the webhook signature from Tatum
   */
  private verifyWebhookSignature(
    payload: TatumWebhookPayload,
    receivedHash: string,
  ): boolean {
    if (!receivedHash) {
      return true; // Skip verification if no hash provided (dev mode)
    }

    const secret = this.configService.get<string>('WEBHOOK_SECRET');
    if (!secret) {
      return true; // Skip if no secret configured
    }

    const computedHash = crypto
      .createHmac('sha512', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return computedHash === receivedHash;
  }

  /**
   * Process an incoming deposit from Tatum webhook
   */
  private async processIncomingDeposit(payload: TatumWebhookPayload) {
    const { address, txId, amount, asset } = payload;

    // Check if this transaction was already processed
    const existingDeposit = await this.prisma.deposit.findFirst({
      where: { txHash: txId },
    });

    if (existingDeposit) {
      this.logger.log(`Transaction ${txId} already processed, skipping`);
      return;
    }

    // Find the wallet in our pool
    const wallet = await this.walletPoolService.findWalletByAddress(address);
    if (!wallet) {
      this.logger.warn(`Received deposit for unknown address: ${address}`);
      return;
    }

    // Check if wallet is assigned to a user
    if (!wallet.assignedToUserId) {
      this.logger.warn(
        `Received deposit for unassigned wallet: ${address}, tx: ${txId}`,
      );
      // Still record the deposit, admin can handle later
      await this.recordOrphanDeposit(wallet, payload);
      return;
    }

    // Validate the asset (must be USDT or accepted token)
    const isValidAsset = this.isValidDepositAsset(asset);
    if (!isValidAsset) {
      this.logger.warn(`Received non-USDT deposit: ${asset} on ${address}`);
      // Record as failed deposit - user sent wrong currency
      await this.recordWrongCurrencyDeposit(wallet, payload);
      return;
    }

    // Parse amount
    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount <= 0) {
      this.logger.warn(`Invalid deposit amount: ${amount}`);
      return;
    }

    // Get user
    const user = await this.prisma.user.findUnique({
      where: { id: wallet.assignedToUserId },
    });

    if (!user) {
      this.logger.error(`User not found for wallet assignment: ${wallet.assignedToUserId}`);
      return;
    }

    // Check if user already received a deposit bonus (one-time only)
    const existingBonus = await this.prisma.transaction.findFirst({
      where: {
        userId: user.id,
        type: 'DEPOSIT_BONUS',
        status: 'CONFIRMED',
        description: { contains: '% deposit bonus' },
      },
    });

    // Calculate bonus (only for first deposit)
    const depositBonus = this.configService.get<number>('DEPOSIT_BONUS_PERCENT', 3);
    const bonusAmount = existingBonus
      ? 0
      : (depositAmount * depositBonus) / 100;
    const totalAmount = depositAmount + bonusAmount;

    this.logger.log(
      `Processing deposit: ${depositAmount} USDT from ${address} for user ${user.username}${existingBonus ? ' (no bonus - already received)' : ''}`,
    );

    // Create deposit and update user balance in transaction
    const txOps: any[] = [
      // Create deposit record
      this.prisma.deposit.create({
        data: {
          userId: user.id,
          amount: new Decimal(depositAmount),
          network: wallet.network,
          depositAddress: address,
          depositWalletId: wallet.id,
          txHash: txId,
          currency: asset || 'USDT',
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          bonusAmount: new Decimal(bonusAmount),
        },
      }),
      // Update user balance
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          balance: { increment: totalAmount },
          totalDeposits: { increment: depositAmount },
        },
      }),
      // Create deposit transaction record
      this.prisma.transaction.create({
        data: {
          userId: user.id,
          type: 'DEPOSIT',
          amount: new Decimal(depositAmount),
          netAmount: new Decimal(depositAmount),
          status: 'CONFIRMED',
          reference: txId,
          description: `Deposit via ${wallet.network}`,
        },
      }),
    ];

    // Only add bonus transaction if this is the first deposit
    if (bonusAmount > 0) {
      txOps.push(
        this.prisma.transaction.create({
          data: {
            userId: user.id,
            type: 'DEPOSIT_BONUS',
            amount: new Decimal(bonusAmount),
            netAmount: new Decimal(bonusAmount),
            status: 'CONFIRMED',
            description: `${depositBonus}% deposit bonus`,
          },
        }),
      );
    }

    await this.prisma.$transaction(txOps);

    // Mark wallet as used
    await this.walletPoolService.markWalletUsed(wallet.id);

    // Process referral bonus
    await this.processReferralBonus(user.id, depositAmount);

    // Send confirmation email
    try {
      await this.emailService.sendDepositConfirmation(
        user.email,
        depositAmount.toString(),
        txId,
      );
    } catch (emailError) {
      this.logger.warn(`Failed to send deposit email: ${emailError.message}`);
    }

    this.logger.log(
      `Deposit confirmed: ${depositAmount} USDT for user ${user.username}, tx: ${txId}`,
    );
  }

  /**
   * Check if the asset is a valid USDT token
   */
  private isValidDepositAsset(asset: string): boolean {
    const validAssets = [
      'USDT',
      'USDT_BSC',
      'USDT_TRON',
      'BSC_USDT',
      'TRC20_USDT',
      'BEP20_USDT',
      // BSC USDT contract addresses
      '0x55d398326f99059fF775485246999027B3197955', // BSC USDT mainnet
      '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd', // BSC USDT testnet
      // TRC20 USDT contract address (TRON mainnet)
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    ];

    return validAssets.some(
      (valid) => asset?.toUpperCase().includes(valid.toUpperCase()),
    );
  }

  /**
   * Record a deposit with wrong currency (e.g., USDC instead of USDT)
   * Creates a FAILED deposit and notifies the user
   */
  private async recordWrongCurrencyDeposit(
    wallet: {
      id: string;
      network: string;
      address: string;
      assignedToUserId: string | null;
    },
    payload: TatumWebhookPayload,
  ) {
    const depositAmount = parseFloat(payload.amount) || 0;

    // Get user info
    const user = wallet.assignedToUserId
      ? await this.prisma.user.findUnique({
          where: { id: wallet.assignedToUserId },
        })
      : null;

    // Create a FAILED deposit record for tracking
    await this.prisma.deposit.create({
      data: {
        userId: user?.id || '00000000-0000-0000-0000-000000000000',
        amount: new Decimal(depositAmount),
        network: wallet.network as 'BEP20' | 'TRC20',
        depositAddress: wallet.address,
        depositWalletId: wallet.id,
        txHash: payload.txId,
        currency: payload.asset || 'UNKNOWN',
        status: 'FAILED', // Wrong currency - needs manual handling
      },
    });

    this.logger.error(
      `WRONG CURRENCY DEPOSIT: ${payload.asset} (${depositAmount}) on ${wallet.address}, tx: ${payload.txId}, user: ${user?.email || 'unknown'}`,
    );

    // Send email to user if we know who they are
    if (user?.email) {
      try {
        await this.emailService.sendWrongCurrencyNotification(
          user.email,
          payload.asset || 'Unknown',
          depositAmount.toString(),
          payload.txId,
        );
      } catch (emailError) {
        this.logger.warn(
          `Failed to send wrong currency email: ${emailError.message}`,
        );
      }
    }
  }

  /**
   * Record a deposit that came to an unassigned wallet
   */
  private async recordOrphanDeposit(
    wallet: { id: string; network: string; address: string },
    payload: TatumWebhookPayload,
  ) {
    // Create an orphan deposit record for admin review
    await this.prisma.deposit.create({
      data: {
        userId: '00000000-0000-0000-0000-000000000000', // Placeholder
        amount: new Decimal(parseFloat(payload.amount) || 0),
        network: wallet.network as 'BEP20' | 'TRC20',
        depositAddress: wallet.address,
        depositWalletId: wallet.id,
        txHash: payload.txId,
        currency: payload.asset || 'UNKNOWN',
        status: 'PENDING', // Needs manual review
      },
    });

    this.logger.warn(
      `Created orphan deposit record for review: ${payload.txId}`,
    );
  }

  /**
   * Process referral bonus when deposit is confirmed
   */
  private async processReferralBonus(userId: string, depositAmount: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { referrer: true },
    });

    if (!user?.referrer) return;

    // Check if referrer already received a referral deposit bonus for this user (one-time only)
    const existingReferralBonus = await this.prisma.transaction.findFirst({
      where: {
        userId: user.referrer.id,
        type: 'DEPOSIT_BONUS',
        status: 'CONFIRMED',
        description: { contains: `from ${user.username}'s deposit` },
      },
    });

    if (existingReferralBonus) {
      this.logger.log(
        `Referral deposit bonus already given to ${user.referrer.username} for ${user.username}, skipping`,
      );
      return;
    }

    // Only Level 1: direct referrer gets 7% deposit referral bonus
    const referralBonusPercent = this.configService.get<number>(
      'REFERRAL_DEPOSIT_BONUS_PERCENT',
      7,
    );
    const bonusAmount = (depositAmount * referralBonusPercent) / 100;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.referrer.id },
        data: {
          balance: { increment: bonusAmount },
        },
      }),
      this.prisma.transaction.create({
        data: {
          userId: user.referrer.id,
          type: 'DEPOSIT_BONUS',
          amount: new Decimal(bonusAmount),
          netAmount: new Decimal(bonusAmount),
          status: 'CONFIRMED',
          description: `${referralBonusPercent}% referral bonus from ${user.username}'s deposit`,
        },
      }),
    ]);

    this.logger.log(
      `Deposit bonus ${bonusAmount} credited to ${user.referrer.username}`,
    );
  }
}
