import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('DepositsController (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let jwtService: JwtService;
  let testUser: any;
  let authToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

    prismaService = moduleFixture.get<PrismaService>(PrismaService);
    jwtService = moduleFixture.get<JwtService>(JwtService);

    await app.init();

    // Create test user
    testUser = await prismaService.user.create({
      data: {
        username: 'deposit_e2e_test',
        email: 'deposit_e2e@test.com',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        referralCode: 'DEP12345',
        status: 'ACTIVE',
        emailVerified: true,
        balance: 0,
      },
    });

    authToken = jwtService.sign({
      sub: testUser.id,
      email: testUser.email,
    });
  });

  afterAll(async () => {
    await prismaService.deposit.deleteMany({
      where: { userId: testUser.id },
    });
    await prismaService.depositWallet.updateMany({
      where: { assignedToUserId: testUser.id },
      data: { assignedToUserId: null, isAvailable: true },
    });
    await prismaService.user.delete({
      where: { id: testUser.id },
    });
    await app.close();
  });

  describe('GET /deposits/address', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/deposits/address')
        .query({ network: 'BEP20' })
        .expect(401);
    });

    it('should fail with invalid network', () => {
      return request(app.getHttpServer())
        .get('/deposits/address')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ network: 'INVALID' })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain('Invalid network');
        });
    });

    it('should return deposit address for BEP20', () => {
      return request(app.getHttpServer())
        .get('/deposits/address')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ network: 'BEP20' })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('address');
          expect(res.body.network).toBe('BEP20');
          expect(res.body).toHaveProperty('expiresAt');
          expect(res.body).toHaveProperty('expiresIn');
          expect(res.body).toHaveProperty('minDeposit');
          expect(res.body).toHaveProperty('depositBonus');
        });
    });
  });

  describe('POST /deposits', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .post('/deposits')
        .send({
          amount: 500,
          network: 'BEP20',
        })
        .expect(401);
    });

    it('should fail with amount below minimum', () => {
      return request(app.getHttpServer())
        .post('/deposits')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: 50,
          network: 'BEP20',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain('Minimum deposit');
        });
    });

    it('should create deposit request after getting address', async () => {
      // First get an address
      await request(app.getHttpServer())
        .get('/deposits/address')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ network: 'BEP20' });

      // Then create deposit
      return request(app.getHttpServer())
        .post('/deposits')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: 500,
          network: 'BEP20',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.amount).toBe(500);
          expect(res.body.status).toBe('PENDING');
          expect(res.body).toHaveProperty('depositAddress');
        });
    });
  });

  describe('GET /deposits/history', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/deposits/history')
        .expect(401);
    });

    it('should return deposit history', () => {
      return request(app.getHttpServer())
        .get('/deposits/history')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });
  });

  describe('GET /deposits/pool-stats', () => {
    it('should return pool statistics', () => {
      return request(app.getHttpServer())
        .get('/deposits/pool-stats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('BEP20');
          expect(res.body).toHaveProperty('TRC20');
        });
    });
  });
});
