import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create investment packages
  const packages = [
    {
      name: 'Bronze',
      durationDays: 30,
      dailyProfit: 3.5,
      minAmount: 100,
      maxAmount: 10000,
    },
    {
      name: 'Silver',
      durationDays: 90,
      dailyProfit: 4.0,
      minAmount: 100,
      maxAmount: 50000,
    },
    {
      name: 'Gold',
      durationDays: 180,
      dailyProfit: 4.6,
      minAmount: 100,
      maxAmount: 100000,
    },
  ];

  for (const pkg of packages) {
    await prisma.package.upsert({
      where: { name: pkg.name },
      update: pkg,
      create: pkg,
    });
    console.log(`Created/Updated package: ${pkg.name}`);
  }

  // Create system admin user (for testing - first referral code)
  const adminPassword = await bcrypt.hash('admin123', 10);
  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: { isAdmin: true },
    create: {
      username: 'admin',
      email: 'admin@alphapro.com',
      password: adminPassword,
      referralCode: 'ADMIN001',
      status: 'ACTIVE',
      emailVerified: true,
      isAdmin: true,
      language: 'en',
    },
  });
  console.log(`Created admin user with referral code: ${adminUser.referralCode}`);

  // Create system config
  const configs = [
    { key: 'min_deposit', value: '100' },
    { key: 'min_withdrawal', value: '5' },
    { key: 'deposit_bonus_percent', value: '3' },
    { key: 'referral_bonus_percent', value: '7' },
    { key: 'team_level1_percent', value: '10' },
    { key: 'team_level2_percent', value: '5' },
    { key: 'trc20_withdraw_fee_percent', value: '5' },
    { key: 'trc20_withdraw_fee_fixed', value: '2' },
    { key: 'bep20_withdraw_fee_percent', value: '3' },
    { key: 'bep20_withdraw_fee_fixed', value: '2' },
  ];

  for (const config of configs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: { value: config.value },
      create: config,
    });
  }
  console.log('Created system configs');

  console.log('Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
