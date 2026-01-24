import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import {
  LinkWalletDto,
  VerifyWalletDto,
  UpdateWalletDto,
  WalletNetwork,
} from './dto/wallet.dto';
import { generateOTP } from '../common/utils/helpers';

interface PendingWalletInfo {
  address: string;
  network: string;
}

@Injectable()
export class WalletService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    return wallet;
  }

  async requestLinkWallet(userId: string, linkWalletDto: LinkWalletDto) {
    const { address, network } = linkWalletDto;

    // Check if user already has a wallet
    const existingWallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (existingWallet) {
      throw new ConflictException(
        'Wallet already linked. Use change wallet instead.',
      );
    }

    // Get user email
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Generate and store verification code
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Invalidate previous codes
    await this.prisma.verificationCode.updateMany({
      where: { userId, type: 'WALLET_LINK', used: false },
      data: { used: true },
    });

    // Create new code with wallet info in metadata
    await this.prisma.verificationCode.create({
      data: {
        userId,
        code,
        type: 'WALLET_LINK',
        expiresAt,
      },
    });

    // Store pending wallet info temporarily
    await this.prisma.systemConfig.upsert({
      where: { key: `pending_wallet_${userId}` },
      update: { value: JSON.stringify({ address, network }) },
      create: {
        key: `pending_wallet_${userId}`,
        value: JSON.stringify({ address, network }),
      },
    });

    // Send verification email
    await this.emailService.sendWalletVerificationEmail(user.email, code);

    return { message: 'Verification code sent to your email' };
  }

  async verifyAndLinkWallet(userId: string, verifyDto: VerifyWalletDto) {
    const { code } = verifyDto;

    // Verify code
    const verificationCode = await this.prisma.verificationCode.findFirst({
      where: {
        userId,
        code,
        type: 'WALLET_LINK',
        used: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!verificationCode) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    // Get pending wallet info
    const pendingWallet = await this.prisma.systemConfig.findUnique({
      where: { key: `pending_wallet_${userId}` },
    });

    if (!pendingWallet) {
      throw new BadRequestException('No pending wallet found');
    }

    const walletInfo = JSON.parse(pendingWallet.value) as PendingWalletInfo;

    // Create wallet and mark code as used
    await this.prisma.$transaction([
      this.prisma.wallet.create({
        data: {
          userId,
          address: walletInfo.address,
          network: walletInfo.network as WalletNetwork,
          verified: true,
        },
      }),
      this.prisma.verificationCode.update({
        where: { id: verificationCode.id },
        data: { used: true },
      }),
      this.prisma.systemConfig.delete({
        where: { key: `pending_wallet_${userId}` },
      }),
    ]);

    return { message: 'Wallet linked successfully' };
  }

  async requestChangeWallet(userId: string, updateDto: UpdateWalletDto) {
    const { address, network } = updateDto;

    // Check if user has a wallet
    const existingWallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!existingWallet) {
      throw new NotFoundException('No wallet found. Link a wallet first.');
    }

    // Get user email
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Generate verification code
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Invalidate previous codes
    await this.prisma.verificationCode.updateMany({
      where: { userId, type: 'WALLET_CHANGE', used: false },
      data: { used: true },
    });

    // Create new code
    await this.prisma.verificationCode.create({
      data: {
        userId,
        code,
        type: 'WALLET_CHANGE',
        expiresAt,
      },
    });

    // Store pending wallet change
    await this.prisma.systemConfig.upsert({
      where: { key: `pending_wallet_change_${userId}` },
      update: { value: JSON.stringify({ address, network }) },
      create: {
        key: `pending_wallet_change_${userId}`,
        value: JSON.stringify({ address, network }),
      },
    });

    // Send verification email
    await this.emailService.sendWalletVerificationEmail(user.email, code);

    return { message: 'Verification code sent to your email' };
  }

  async verifyAndChangeWallet(userId: string, verifyDto: VerifyWalletDto) {
    const { code } = verifyDto;

    // Verify code
    const verificationCode = await this.prisma.verificationCode.findFirst({
      where: {
        userId,
        code,
        type: 'WALLET_CHANGE',
        used: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!verificationCode) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    // Get pending wallet change
    const pendingChange = await this.prisma.systemConfig.findUnique({
      where: { key: `pending_wallet_change_${userId}` },
    });

    if (!pendingChange) {
      throw new BadRequestException('No pending wallet change found');
    }

    const walletInfo = JSON.parse(pendingChange.value) as PendingWalletInfo;

    // Update wallet
    await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { userId },
        data: {
          address: walletInfo.address,
          network: walletInfo.network as WalletNetwork,
        },
      }),
      this.prisma.verificationCode.update({
        where: { id: verificationCode.id },
        data: { used: true },
      }),
      this.prisma.systemConfig.delete({
        where: { key: `pending_wallet_change_${userId}` },
      }),
    ]);

    return { message: 'Wallet updated successfully' };
  }
}
