// Mock uuid before importing helpers
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'),
}));

import {
  generateReferralCode,
  generateOTP,
  calculateWithdrawalFee,
  calculateDailyProfit,
  getWeekBounds,
  getWeeklySalaryAmount,
} from './helpers';

describe('Helpers', () => {
  describe('generateReferralCode', () => {
    it('should generate 8 character uppercase code', () => {
      const code = generateReferralCode();

      expect(code).toHaveLength(8);
      expect(code).toBe(code.toUpperCase());
    });

    it('should generate uppercase code from uuid', () => {
      const code = generateReferralCode();
      expect(code).toBe('A1B2C3D4');
    });
  });

  describe('generateOTP', () => {
    it('should generate 6 digit numeric code', () => {
      const otp = generateOTP();

      expect(otp).toHaveLength(6);
      expect(/^\d{6}$/.test(otp)).toBe(true);
    });

    it('should generate codes between 100000 and 999999', () => {
      for (let i = 0; i < 100; i++) {
        const otp = parseInt(generateOTP(), 10);
        expect(otp).toBeGreaterThanOrEqual(100000);
        expect(otp).toBeLessThanOrEqual(999999);
      }
    });
  });

  describe('calculateWithdrawalFee', () => {
    describe('BEP20 fees (3% + $2)', () => {
      it('should calculate fee for $100', () => {
        const result = calculateWithdrawalFee(100, 'BEP20');

        expect(result.fee).toBe(5); // 3% of 100 = 3 + 2 = 5
        expect(result.netAmount).toBe(95); // 100 - 5
      });

      it('should calculate fee for $1000', () => {
        const result = calculateWithdrawalFee(1000, 'BEP20');

        expect(result.fee).toBe(32); // 3% of 1000 = 30 + 2 = 32
        expect(result.netAmount).toBe(968); // 1000 - 32
      });

      it('should calculate fee for $50', () => {
        const result = calculateWithdrawalFee(50, 'BEP20');

        expect(result.fee).toBe(3.5); // 3% of 50 = 1.5 + 2 = 3.5
        expect(result.netAmount).toBe(46.5); // 50 - 3.5
      });
    });

    describe('TRC20 fees (5% + $2)', () => {
      it('should calculate fee for $100', () => {
        const result = calculateWithdrawalFee(100, 'TRC20');

        expect(result.fee).toBe(7); // 5% of 100 = 5 + 2 = 7
        expect(result.netAmount).toBe(93); // 100 - 7
      });

      it('should calculate fee for $1000', () => {
        const result = calculateWithdrawalFee(1000, 'TRC20');

        expect(result.fee).toBe(52); // 5% of 1000 = 50 + 2 = 52
        expect(result.netAmount).toBe(948); // 1000 - 52
      });

      it('should calculate fee for $50', () => {
        const result = calculateWithdrawalFee(50, 'TRC20');

        expect(result.fee).toBe(4.5); // 5% of 50 = 2.5 + 2 = 4.5
        expect(result.netAmount).toBe(45.5); // 50 - 4.5
      });
    });
  });

  describe('calculateDailyProfit', () => {
    it('should calculate 3.5% daily profit', () => {
      const profit = calculateDailyProfit(1000, 3.5);
      expect(profit).toBe(35);
    });

    it('should calculate 4.0% daily profit', () => {
      const profit = calculateDailyProfit(1000, 4.0);
      expect(profit).toBe(40);
    });

    it('should calculate 4.6% daily profit', () => {
      const profit = calculateDailyProfit(1000, 4.6);
      expect(profit).toBe(46);
    });

    it('should handle small amounts', () => {
      const profit = calculateDailyProfit(100, 3.5);
      expect(profit).toBe(3.5);
    });

    it('should handle large amounts', () => {
      const profit = calculateDailyProfit(100000, 4.6);
      expect(profit).toBeCloseTo(4600, 2);
    });
  });

  describe('getWeekBounds', () => {
    it('should return week start and end for a given date', () => {
      // Test with a Wednesday
      const testDate = new Date('2024-01-10'); // Wednesday
      const { weekStart, weekEnd } = getWeekBounds(testDate);

      expect(weekStart.getDay()).toBe(0); // Sunday
      expect(weekEnd.getDay()).toBe(6); // Saturday
    });

    it('should set correct times for week bounds', () => {
      const testDate = new Date('2024-01-10');
      const { weekStart, weekEnd } = getWeekBounds(testDate);

      expect(weekStart.getHours()).toBe(0);
      expect(weekStart.getMinutes()).toBe(0);
      expect(weekStart.getSeconds()).toBe(0);

      expect(weekEnd.getHours()).toBe(23);
      expect(weekEnd.getMinutes()).toBe(59);
      expect(weekEnd.getSeconds()).toBe(59);
    });

    it('should handle Sunday correctly', () => {
      const sunday = new Date('2024-01-07'); // Sunday
      const { weekStart, weekEnd } = getWeekBounds(sunday);

      expect(weekStart.getDate()).toBe(7); // Same day
    });

    it('should use current date if none provided', () => {
      const { weekStart, weekEnd } = getWeekBounds();

      expect(weekStart).toBeInstanceOf(Date);
      expect(weekEnd).toBeInstanceOf(Date);
      expect(weekEnd > weekStart).toBe(true);
    });
  });

  describe('getWeeklySalaryAmount', () => {
    it('should return $0 for less than 10 referrals', () => {
      expect(getWeeklySalaryAmount(0)).toBe(0);
      expect(getWeeklySalaryAmount(5)).toBe(0);
      expect(getWeeklySalaryAmount(9)).toBe(0);
    });

    it('should return $30 for 10-24 referrals', () => {
      expect(getWeeklySalaryAmount(10)).toBe(30);
      expect(getWeeklySalaryAmount(15)).toBe(30);
      expect(getWeeklySalaryAmount(24)).toBe(30);
    });

    it('should return $50 for 25-49 referrals', () => {
      expect(getWeeklySalaryAmount(25)).toBe(50);
      expect(getWeeklySalaryAmount(35)).toBe(50);
      expect(getWeeklySalaryAmount(49)).toBe(50);
    });

    it('should return $75 for 50-99 referrals', () => {
      expect(getWeeklySalaryAmount(50)).toBe(75);
      expect(getWeeklySalaryAmount(75)).toBe(75);
      expect(getWeeklySalaryAmount(99)).toBe(75);
    });

    it('should return $120 for 100+ referrals', () => {
      expect(getWeeklySalaryAmount(100)).toBe(120);
      expect(getWeeklySalaryAmount(150)).toBe(120);
      expect(getWeeklySalaryAmount(1000)).toBe(120);
    });
  });
});
