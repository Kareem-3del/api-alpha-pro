import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('WalletController (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let jwtService: JwtService;
  let testUser: any;
  let userWithWallet: any;
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
        username: 'wallet_e2e_test',
        email: 'wallet_e2e@test.com',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        referralCode: 'WAL12345',
        status: 'ACTIVE',
        emailVerified: true,
      },
    });

    // Create test user with wallet
    userWithWallet = await prismaService.user.create({
      data: {
        username: 'wallet_e2e_test2',
        email: 'wallet_e2e2@test.com',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        referralCode: 'WAL54321',
        status: 'ACTIVE',
        emailVerified: true,
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
      sub: userWithWallet.id,
      email: userWithWallet.email,
    });
  });

  afterAll(async () => {
    await prismaService.verificationCode.deleteMany({
      where: { userId: { in: [testUser.id, userWithWallet.id] } },
    });
    await prismaService.systemConfig.deleteMany({
      where: { key: { startsWith: 'pending_wallet' } },
    });
    await prismaService.wallet.deleteMany({
      where: { userId: userWithWallet.id },
    });
    await prismaService.user.deleteMany({
      where: { id: { in: [testUser.id, userWithWallet.id] } },
    });
    await app.close();
  });

  describe('GET /wallet', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/wallet')
        .expect(401);
    });

    it('should return null for user without wallet', () => {
      return request(app.getHttpServer())
        .get('/wallet')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toBeNull();
        });
    });

    it('should return wallet for user with wallet', () => {
      return request(app.getHttpServer())
        .get('/wallet')
        .set('Authorization', `Bearer ${authTokenWithWallet}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.address).toBe('0x1234567890123456789012345678901234567890');
          expect(res.body.network).toBe('BEP20');
          expect(res.body.verified).toBe(true);
        });
    });
  });

  describe('POST /wallet/link', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .post('/wallet/link')
        .send({
          address: '0x1234567890123456789012345678901234567890',
          network: 'BEP20',
        })
        .expect(401);
    });

    it('should fail if wallet already linked', () => {
      return request(app.getHttpServer())
        .post('/wallet/link')
        .set('Authorization', `Bearer ${authTokenWithWallet}`)
        .send({
          address: '0xnewaddress12345678901234567890123456789',
          network: 'BEP20',
        })
        .expect(409)
        .expect((res) => {
          expect(res.body.message).toContain('Wallet already linked');
        });
    });

    it('should send verification code for new wallet', () => {
      return request(app.getHttpServer())
        .post('/wallet/link')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          address: '0x1234567890123456789012345678901234567890',
          network: 'BEP20',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.message).toContain('Verification code sent');
        });
    });
  });

  describe('POST /wallet/verify-link', () => {
    it('should fail with invalid code', () => {
      return request(app.getHttpServer())
        .post('/wallet/verify-link')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          code: '000000',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain('Invalid or expired');
        });
    });
  });

  describe('POST /wallet/change', () => {
    it('should fail for user without wallet', () => {
      return request(app.getHttpServer())
        .post('/wallet/change')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          address: '0xnewaddress12345678901234567890123456789',
          network: 'TRC20',
        })
        .expect(404)
        .expect((res) => {
          expect(res.body.message).toContain('No wallet found');
        });
    });

    it('should send verification code for wallet change', () => {
      return request(app.getHttpServer())
        .post('/wallet/change')
        .set('Authorization', `Bearer ${authTokenWithWallet}`)
        .send({
          address: '0xnewaddress12345678901234567890123456789',
          network: 'TRC20',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.message).toContain('Verification code sent');
        });
    });
  });
});
