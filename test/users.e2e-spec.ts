import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('UsersController (e2e)', () => {
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
        username: 'user_e2e_test',
        email: 'user_e2e@test.com',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        referralCode: 'USER1234',
        status: 'ACTIVE',
        emailVerified: true,
        balance: 1000,
        totalDeposits: 500,
        totalWithdrawals: 100,
        totalProfit: 50,
      },
    });

    // Generate auth token
    authToken = jwtService.sign({
      sub: testUser.id,
      email: testUser.email,
    });
  });

  afterAll(async () => {
    await prismaService.user.delete({
      where: { id: testUser.id },
    });
    await app.close();
  });

  describe('GET /users/profile', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/users/profile')
        .expect(401);
    });

    it('should return user profile with valid token', () => {
      return request(app.getHttpServer())
        .get('/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(testUser.id);
          expect(res.body.username).toBe('user_e2e_test');
          expect(res.body.email).toBe('user_e2e@test.com');
          expect(res.body.referralCode).toBe('USER1234');
          expect(res.body.hasWallet).toBe(false);
        });
    });
  });

  describe('GET /users/dashboard', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/users/dashboard')
        .expect(401);
    });

    it('should return dashboard data with valid token', () => {
      return request(app.getHttpServer())
        .get('/users/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('balance');
          expect(res.body).toHaveProperty('totalDeposits');
          expect(res.body).toHaveProperty('totalWithdrawals');
          expect(res.body).toHaveProperty('totalProfit');
          expect(res.body).toHaveProperty('referralCode');
          expect(res.body).toHaveProperty('referralCount');
          expect(res.body).toHaveProperty('hasWallet');
          expect(res.body).toHaveProperty('currentWeeklySalary');
          expect(res.body).toHaveProperty('activeInvestments');
          expect(res.body).toHaveProperty('recentTransactions');
        });
    });
  });

  describe('PUT /users/language', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .put('/users/language')
        .send({ language: 'ar' })
        .expect(401);
    });

    it('should update user language', () => {
      return request(app.getHttpServer())
        .put('/users/language')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ language: 'ar' })
        .expect(200)
        .expect((res) => {
          expect(res.body.message).toContain('Language updated');
        });
    });
  });
});
