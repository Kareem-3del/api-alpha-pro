import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  private readonly isDevMode: boolean;
  private readonly appName = 'Alpha Pro';
  private readonly supportEmail = 'support@alphapro.com';
  private readonly websiteUrl = 'https://alphapro.com';

  constructor(private configService: ConfigService) {
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');
    this.isDevMode = !smtpUser || !smtpPass ||
                     smtpUser.includes('your-') ||
                     smtpPass.includes('your-');

    if (this.isDevMode) {
      this.logger.warn('Email service running in DEV MODE - emails will be logged to console');
    }

    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT'),
      secure: false,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });
  }

  private getEmailTemplate(content: string, footerText?: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.appName}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7fa; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f7fa;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08); overflow: hidden;">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 32px 40px; text-align: center;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <!-- Logo -->
                    <div style="display: inline-block; background: linear-gradient(135deg, #00C853 0%, #00E676 100%); width: 60px; height: 60px; border-radius: 16px; line-height: 60px; margin-bottom: 12px;">
                      <span style="color: #1a1a2e; font-size: 28px; font-weight: bold;">A</span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">
                      ALPHA <span style="background: linear-gradient(135deg, #00C853 0%, #00E676 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">PRO</span>
                    </h1>
                    <p style="margin: 8px 0 0 0; color: #8892b0; font-size: 14px;">Secure Investment Platform</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border-top: 1px solid #e2e8f0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    ${footerText ? `<p style="margin: 0 0 16px 0; color: #64748b; font-size: 13px;">${footerText}</p>` : ''}
                    <p style="margin: 0 0 8px 0; color: #94a3b8; font-size: 12px;">
                      Need help? <a href="mailto:${this.supportEmail}" style="color: #00C853; text-decoration: none;">Contact Support</a>
                    </p>
                    <p style="margin: 0; color: #cbd5e1; font-size: 11px;">
                      &copy; ${new Date().getFullYear()} ${this.appName}. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private getOtpBox(code: string): string {
    return `
      <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #00C853; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
        <p style="margin: 0 0 8px 0; color: #166534; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Your Verification Code</p>
        <div style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #00C853; font-family: 'Courier New', monospace;">${code}</div>
        <p style="margin: 12px 0 0 0; color: #15803d; font-size: 13px;">Valid for 15 minutes</p>
      </div>`;
  }

  private getInfoBox(title: string, items: { label: string; value: string }[], type: 'success' | 'warning' | 'error' | 'info' = 'info'): string {
    const colors = {
      success: { bg: '#f0fdf4', border: '#00C853', text: '#166534' },
      warning: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' },
      error: { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' },
      info: { bg: '#f0f9ff', border: '#0ea5e9', text: '#0c4a6e' },
    };
    const c = colors[type];

    const itemsHtml = items.map(item => `
      <tr>
        <td style="padding: 8px 0; color: #64748b; font-size: 14px; border-bottom: 1px solid #e2e8f0;">${item.label}</td>
        <td style="padding: 8px 0; color: ${c.text}; font-size: 14px; font-weight: 600; text-align: right; border-bottom: 1px solid #e2e8f0;">${item.value}</td>
      </tr>
    `).join('');

    return `
      <div style="background: ${c.bg}; border-left: 4px solid ${c.border}; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <h3 style="margin: 0 0 16px 0; color: ${c.text}; font-size: 16px; font-weight: 600;">${title}</h3>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          ${itemsHtml}
        </table>
      </div>`;
  }

  private getButton(text: string, url: string): string {
    return `
      <div style="text-align: center; margin: 32px 0;">
        <a href="${url}" style="display: inline-block; background: linear-gradient(135deg, #00C853 0%, #00E676 100%); color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 200, 83, 0.3);">${text}</a>
      </div>`;
  }

  private async sendOrLog(to: string, subject: string, html: string, logData?: { code?: string }): Promise<void> {
    if (this.isDevMode) {
      this.logger.warn(`=== DEV MODE EMAIL ===`);
      this.logger.warn(`To: ${to}`);
      this.logger.warn(`Subject: ${subject}`);
      if (logData?.code) {
        this.logger.warn(`>>> OTP CODE: ${logData.code} <<<`);
      }
      this.logger.warn(`======================`);
      return;
    }

    await this.transporter.sendMail({
      from: this.configService.get<string>('SMTP_FROM'),
      to,
      subject,
      html,
    });
  }

  async sendVerificationEmail(to: string, code: string): Promise<void> {
    const content = `
      <h2 style="margin: 0 0 16px 0; color: #1e293b; font-size: 24px; font-weight: 700;">Welcome to Alpha Pro!</h2>
      <p style="margin: 0 0 8px 0; color: #475569; font-size: 15px; line-height: 1.6;">
        Thank you for joining Alpha Pro. To complete your registration, please verify your email address using the code below.
      </p>
      ${this.getOtpBox(code)}
      <div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <p style="margin: 0; color: #92400e; font-size: 13px;">
          <strong>Security Tip:</strong> Never share this code with anyone. Alpha Pro staff will never ask for your verification code.
        </p>
      </div>
    `;

    const html = this.getEmailTemplate(content, "If you didn't create an account, please ignore this email.");
    await this.sendOrLog(to, `${this.appName} - Verify Your Email`, html, { code });
  }

  async sendWalletVerificationEmail(to: string, code: string): Promise<void> {
    const content = `
      <h2 style="margin: 0 0 16px 0; color: #1e293b; font-size: 24px; font-weight: 700;">Wallet Verification</h2>
      <p style="margin: 0 0 8px 0; color: #475569; font-size: 15px; line-height: 1.6;">
        You've requested to link or update your withdrawal wallet. Please use the verification code below to confirm this action.
      </p>
      ${this.getOtpBox(code)}
      <div style="background: #fee2e2; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <p style="margin: 0; color: #991b1b; font-size: 13px;">
          <strong>Important:</strong> If you didn't request this change, please secure your account immediately and contact support.
        </p>
      </div>
    `;

    const html = this.getEmailTemplate(content, "This code will expire in 15 minutes.");
    await this.sendOrLog(to, `${this.appName} - Wallet Verification`, html, { code });
  }

  async sendDepositConfirmation(to: string, amount: string, txHash: string): Promise<void> {
    const content = `
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; background: #dcfce7; width: 64px; height: 64px; border-radius: 50%; line-height: 64px;">
          <span style="color: #00C853; font-size: 32px;">✓</span>
        </div>
      </div>
      <h2 style="margin: 0 0 16px 0; color: #1e293b; font-size: 24px; font-weight: 700; text-align: center;">Deposit Confirmed!</h2>
      <p style="margin: 0 0 24px 0; color: #475569; font-size: 15px; line-height: 1.6; text-align: center;">
        Great news! Your deposit has been successfully confirmed and credited to your account.
      </p>
      ${this.getInfoBox('Transaction Details', [
        { label: 'Amount', value: `$${amount} USDT` },
        { label: 'Status', value: 'Confirmed' },
        { label: 'Transaction Hash', value: `${txHash.substring(0, 20)}...` },
      ], 'success')}
      <p style="margin: 24px 0 0 0; color: #475569; font-size: 15px; line-height: 1.6; text-align: center;">
        Your balance has been updated. Start investing now to earn daily profits!
      </p>
    `;

    const html = this.getEmailTemplate(content);
    await this.sendOrLog(to, `${this.appName} - Deposit Confirmed ($${amount} USDT)`, html);
  }

  async sendWithdrawalNotification(to: string, amount: string, status: string): Promise<void> {
    const statusConfig = {
      CONFIRMED: { icon: '✓', color: '#00C853', bg: '#dcfce7', type: 'success' as const },
      PENDING: { icon: '⏳', color: '#f59e0b', bg: '#fef3c7', type: 'warning' as const },
      FAILED: { icon: '✕', color: '#ef4444', bg: '#fee2e2', type: 'error' as const },
      REJECTED: { icon: '✕', color: '#ef4444', bg: '#fee2e2', type: 'error' as const },
    };
    const config = statusConfig[status] || statusConfig.PENDING;

    const content = `
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; background: ${config.bg}; width: 64px; height: 64px; border-radius: 50%; line-height: 64px;">
          <span style="color: ${config.color}; font-size: 32px;">${config.icon}</span>
        </div>
      </div>
      <h2 style="margin: 0 0 16px 0; color: #1e293b; font-size: 24px; font-weight: 700; text-align: center;">Withdrawal ${status}</h2>
      <p style="margin: 0 0 24px 0; color: #475569; font-size: 15px; line-height: 1.6; text-align: center;">
        ${status === 'CONFIRMED' ? 'Your withdrawal has been processed successfully.' :
          status === 'PENDING' ? 'Your withdrawal request is being processed.' :
          'There was an issue with your withdrawal request.'}
      </p>
      ${this.getInfoBox('Withdrawal Details', [
        { label: 'Amount', value: `$${amount} USDT` },
        { label: 'Status', value: status },
      ], config.type)}
      ${status === 'FAILED' || status === 'REJECTED' ? `
        <p style="margin: 24px 0 0 0; color: #475569; font-size: 15px; line-height: 1.6; text-align: center;">
          If you believe this is an error, please contact our support team.
        </p>
        ${this.getButton('Contact Support', `mailto:${this.supportEmail}`)}
      ` : ''}
    `;

    const html = this.getEmailTemplate(content);
    await this.sendOrLog(to, `${this.appName} - Withdrawal ${status}`, html);
  }

  async sendPinOtpEmail(to: string, code: string): Promise<void> {
    const content = `
      <h2 style="margin: 0 0 16px 0; color: #1e293b; font-size: 24px; font-weight: 700;">PIN Verification</h2>
      <p style="margin: 0 0 8px 0; color: #475569; font-size: 15px; line-height: 1.6;">
        You've requested to set or change your withdrawal PIN. Please use the verification code below to confirm this action.
      </p>
      ${this.getOtpBox(code)}
      <div style="background: #fee2e2; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <p style="margin: 0; color: #991b1b; font-size: 13px;">
          <strong>Security Alert:</strong> Never share your PIN or verification code with anyone. Alpha Pro support will never ask for your PIN.
        </p>
      </div>
    `;

    const html = this.getEmailTemplate(content, "If you didn't request this code, please secure your account immediately.");
    await this.sendOrLog(to, `${this.appName} - PIN Verification Code`, html, { code });
  }

  async sendWrongCurrencyNotification(to: string, currency: string, amount: string, txHash: string): Promise<void> {
    const content = `
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; background: #fee2e2; width: 64px; height: 64px; border-radius: 50%; line-height: 64px;">
          <span style="color: #ef4444; font-size: 32px;">⚠</span>
        </div>
      </div>
      <h2 style="margin: 0 0 16px 0; color: #991b1b; font-size: 24px; font-weight: 700; text-align: center;">Wrong Currency Detected</h2>
      <p style="margin: 0 0 24px 0; color: #475569; font-size: 15px; line-height: 1.6; text-align: center;">
        We detected a deposit with an unsupported currency. This deposit was <strong>NOT credited</strong> to your account.
      </p>
      ${this.getInfoBox('Transaction Details', [
        { label: 'Currency Sent', value: currency },
        { label: 'Amount', value: amount },
        { label: 'Transaction Hash', value: `${txHash.substring(0, 20)}...` },
        { label: 'Status', value: 'Not Credited' },
      ], 'error')}
      <div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <p style="margin: 0; color: #92400e; font-size: 13px;">
          <strong>Important:</strong> Alpha Pro only accepts <strong>USDT</strong> deposits. To recover your funds, please contact our support team with the transaction hash.
        </p>
      </div>
      ${this.getButton('Contact Support', `mailto:${this.supportEmail}?subject=Wrong Currency Deposit - ${txHash}`)}
    `;

    const html = this.getEmailTemplate(content);
    await this.sendOrLog(to, `⚠️ ${this.appName} - Wrong Currency Deposit`, html);
  }

  async sendWelcomeEmail(to: string, username: string): Promise<void> {
    const content = `
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; background: #dcfce7; width: 64px; height: 64px; border-radius: 50%; line-height: 64px;">
          <span style="color: #00C853; font-size: 32px;">🎉</span>
        </div>
      </div>
      <h2 style="margin: 0 0 16px 0; color: #1e293b; font-size: 24px; font-weight: 700; text-align: center;">Welcome, ${username}!</h2>
      <p style="margin: 0 0 24px 0; color: #475569; font-size: 15px; line-height: 1.6; text-align: center;">
        Your account has been verified successfully. You're now ready to start your investment journey with Alpha Pro.
      </p>
      ${this.getInfoBox('Getting Started', [
        { label: '1. Make a Deposit', value: 'Fund your account' },
        { label: '2. Choose a Package', value: 'Select an investment plan' },
        { label: '3. Earn Daily Profits', value: 'Watch your money grow' },
      ], 'success')}
      <p style="margin: 24px 0 0 0; color: #475569; font-size: 15px; line-height: 1.6; text-align: center;">
        Don't forget to set up your withdrawal PIN and link your wallet for seamless transactions!
      </p>
    `;

    const html = this.getEmailTemplate(content, "Start investing today and earn daily profits!");
    await this.sendOrLog(to, `🎉 Welcome to ${this.appName}!`, html);
  }

  async sendDailyProfitNotification(to: string, username: string, profit: string, totalBalance: string): Promise<void> {
    const content = `
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; background: #dcfce7; width: 64px; height: 64px; border-radius: 50%; line-height: 64px;">
          <span style="color: #00C853; font-size: 32px;">💰</span>
        </div>
      </div>
      <h2 style="margin: 0 0 16px 0; color: #1e293b; font-size: 24px; font-weight: 700; text-align: center;">Daily Profit Credited!</h2>
      <p style="margin: 0 0 24px 0; color: #475569; font-size: 15px; line-height: 1.6; text-align: center;">
        Hi ${username}, your daily investment profit has been credited to your account!
      </p>
      ${this.getInfoBox('Profit Summary', [
        { label: "Today's Profit", value: `+$${profit} USDT` },
        { label: 'New Balance', value: `$${totalBalance} USDT` },
      ], 'success')}
      <p style="margin: 24px 0 0 0; color: #475569; font-size: 15px; line-height: 1.6; text-align: center;">
        Keep investing to maximize your earnings!
      </p>
    `;

    const html = this.getEmailTemplate(content);
    await this.sendOrLog(to, `💰 ${this.appName} - Daily Profit +$${profit}`, html);
  }

  async sendWeeklySalaryNotification(to: string, username: string, salary: string, referralCount: number): Promise<void> {
    const content = `
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; background: #dcfce7; width: 64px; height: 64px; border-radius: 50%; line-height: 64px;">
          <span style="color: #00C853; font-size: 32px;">🏆</span>
        </div>
      </div>
      <h2 style="margin: 0 0 16px 0; color: #1e293b; font-size: 24px; font-weight: 700; text-align: center;">Weekly Team Salary!</h2>
      <p style="margin: 0 0 24px 0; color: #475569; font-size: 15px; line-height: 1.6; text-align: center;">
        Congratulations ${username}! Your weekly team salary has been credited to your account.
      </p>
      ${this.getInfoBox('Salary Details', [
        { label: 'Weekly Salary', value: `$${salary} USDT` },
        { label: 'Team Members', value: `${referralCount} referrals` },
      ], 'success')}
      <p style="margin: 24px 0 0 0; color: #475569; font-size: 15px; line-height: 1.6; text-align: center;">
        Grow your team to unlock higher salary tiers!
      </p>
    `;

    const html = this.getEmailTemplate(content);
    await this.sendOrLog(to, `🏆 ${this.appName} - Weekly Salary $${salary}`, html);
  }
}
