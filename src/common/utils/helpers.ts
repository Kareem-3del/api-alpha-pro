import { v4 as uuidv4 } from 'uuid';

export function generateReferralCode(): string {
  return uuidv4().slice(0, 8).toUpperCase();
}

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function calculateWithdrawalFee(
  amount: number,
  network: 'BEP20' | 'TRC20',
): { fee: number; netAmount: number } {
  let feePercent: number;
  let fixedFee: number;

  if (network === 'TRC20') {
    feePercent = 5;
    fixedFee = 2;
  } else {
    feePercent = 3;
    fixedFee = 2;
  }

  const percentageFee = (amount * feePercent) / 100;
  const totalFee = percentageFee + fixedFee;
  const netAmount = amount - totalFee;

  return { fee: totalFee, netAmount };
}

export function calculateDailyProfit(
  amount: number,
  profitPercent: number,
): number {
  return (amount * profitPercent) / 100;
}

export function getWeekBounds(date: Date = new Date()): {
  weekStart: Date;
  weekEnd: Date;
} {
  const weekStart = new Date(date);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
}

export function getWeeklySalaryAmount(referralCount: number): number {
  if (referralCount >= 100) return 120;
  if (referralCount >= 50) return 75;
  if (referralCount >= 25) return 50;
  if (referralCount >= 10) return 30;
  return 0;
}
