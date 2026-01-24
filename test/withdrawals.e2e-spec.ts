import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('WithdrawalsController (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let jwtService: JwtService;
  let testUser: any;
  let testUserWithWallet: any;
  let authToken: string;
  let authTokenWithWallet: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

    prismaService = moduleFixture.get<PrismaService>(PrismaService);
    jwtService = moduleFixture.get<JwtService>(JwtService);

    await app.init();

    // Create test user without wallet
    testUser = await prismaService.user.create({
      data: {
        username: 'withdraw_e2e_test',
        email: 'withdraw_e2e@test.com',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        referralCode: 'WIT12345',
        status: 'ACTIVE',
        emailVerified: true,
        balance: 1000,
      },
    });

    // Create test user with wallet
    testUserWithWallet = await prismaService.user.create({
      data: {
        username: 'withdraw_e2e_test2',
        email: 'withdraw_e2e2@test.com',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        referralCode: 'WIT54321',
        status: 'ACTIVE',
        emailVerified: true,
        balance: 1000,
        wallet: {
          create: {
            address: '0x1234567890123456789012345678901234567890',
            network: 'BEP20',
            verified: true,
          },
        },
      },
    });

    authToken = jwtService.sign({
      sub: testUser.id,
      email: testUser.email,
    });

    authTokenWithWallet = jwtService.sign({
      sub: testUserWithWallet.id,
      email: testUserWithWallet.email,
    });
  });

  afterAll(async () => {
    await prismaService.transaction.deleteMany({
      where: { userId: { in: [testUser.id, testUserWithWallet.id] } },
    });
    await prismaService.withdrawal.deleteMany({
      where: { userId: { in: [testUser.id, testUserWithWallet.id] } },
    });
    await prismaService.wallet.deleteMany({
      where: { userId: testUserWithWallet.id },
    });
    await prismaService.user.deleteMany({
      where: { id: { in: [testUser.id, testUserWithWallet.id] } },
    });
    await app.close();
  });

  describe('POST /withdrawals', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .post('/withdrawals')
        .send({
          amount: 100,
          network: 'BEP20',
          pin: '1234',
        })
        .expect(401);
    });

    it('should fail with amount below minimum', () => {
      return request(app.getHttpServer())
        .post('/withdrawals')
        .set('Authorization', `Bearer ${authTokenWithWallet}`)
        .send({
          amount: 2,
          network: 'BEP20',
          pin: '1234',
        })
        .expect(400)
        .expect((res) => {
          // Validation error from class-validator @Min(5) decorator
          const messages = Array.isArray(res.body.message) ? res.body.message : [res.body.message];
          expect(messages.some((m: string) => m.toLowerCase().includes('amount') || m.toLowerCase().includes('less than'))).toBe(true);
        });
    });

    it('should fail without linked wallet', () => {
      return request(app.getHttpServer())
        .post('/withdrawals')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: 100,
          network: 'BEP20',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain('link a wallet');
        });
    });

    it('should create withdrawal with correct fees for BEP20', () => {
      return request(app.getHttpServer())
        .post('/withdrawals')
        .set('Authorization', `Bearer ${authTokenWithWallet}`)
        .send({
          amount: 100,
          network: 'BEP20',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(Number(res.body.amount)).toBe(100);
          expect(Number(res.body.fee)).toBe(5); // 3% + $2
          expect(Number(res.body.netAmount)).toBe(95);
          expect(res.body.status).toBe('PENDING');
          expect(res.body.toAddress).toBe('0x1234567890123456789012345678901234567890');
        });
    });

    it('should fail with insufficient balance', async () => {
      // Update balance to 0
      await prismaService.user.update({
        where: { id: testUserWithWallet.id },
        data: { balance: 0 },
      });

      return request(app.getHttpServer())
        .post('/withdrawals')
        .set('Authorization', `Bearer ${authTokenWithWallet}`)
        .send({
          amount: 100,
          network: 'BEP20',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain('Insufficient balance');
        });
    });
  });

  describe('GET /withdrawals/history', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/withdrawals/history')
        .expect(401);
    });

    it('should return withdrawal history', () => {
      return request(app.getHttpServer())
        .get('/withdrawals/history')
        .set('Authorization', `Bearer ${authTokenWithWallet}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });
  });

  describe('GET /withdrawals/fees', () => {
    it('should calculate fees for BEP20', () => {
      return request(app.getHttpServer())
        .get('/withdrawals/fees')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ amount: 100, network: 'BEP20' })
        .expect(200)
        .expect((res) => {
          expect(res.body.fee).toBe(5); // 3% + $2
          expect(res.body.netAmount).toBe(95);
        });
    });

    it('should calculate fees for TRC20', () => {
      return request(app.getHttpServer())
        .get('/withdrawals/fees')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ amount: 100, network: 'TRC20' })
        .expect(200)
        .expect((res) => {
          expect(res.body.fee).toBe(7); // 5% + $2
          expect(res.body.netAmount).toBe(93);
        });
    });
  });
});
