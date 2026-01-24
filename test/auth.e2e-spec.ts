import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let referrerUser: any;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

    prismaService = moduleFixture.get<PrismaService>(PrismaService);

    await app.init();

    // Create a referrer user for testing
    referrerUser = await prismaService.user.create({
      data: {
        username: 'referrer_test',
        email: 'referrer@test.com',
        password: '$2b$10$abcdefghijklmnopqrstuv', // hashed "password123"
        referralCode: 'REFTEST1',
        status: 'ACTIVE',
        emailVerified: true,
      },
    });
  });

  afterAll(async () => {
    // Clean up test data
    await prismaService.verificationCode.deleteMany({
      where: { userId: referrerUser.id },
    });
    await prismaService.user.deleteMany({
      where: {
        OR: [
          { username: 'referrer_test' },
          { username: 'testuser_e2e' },
        ],
      },
    });
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('should fail with missing fields', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'testuser_e2e',
        })
        .expect(400);
    });

    it('should fail with password mismatch', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'testuser_e2e',
          email: 'test_e2e@example.com',
          password: 'password123',
          confirmPassword: 'differentpassword',
          referralCode: 'REFTEST1',
          language: 'en',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain('Passwords do not match');
        });
    });

    it('should fail with invalid referral code', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'testuser_e2e',
          email: 'test_e2e@example.com',
          password: 'password123',
          confirmPassword: 'password123',
          referralCode: 'INVALID',
          language: 'en',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain('Invalid referral code');
        });
    });

    it('should register successfully with valid data', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'testuser_e2e',
          email: 'test_e2e@example.com',
          password: 'password123',
          confirmPassword: 'password123',
          referralCode: 'REFTEST1',
          language: 'en',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.message).toContain('Registration successful');
          expect(res.body.userId).toBeDefined();
        });
    });

    it('should fail with duplicate username', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'testuser_e2e',
          email: 'another@example.com',
          password: 'password123',
          confirmPassword: 'password123',
          referralCode: 'REFTEST1',
          language: 'en',
        })
        .expect(409)
        .expect((res) => {
          expect(res.body.message).toContain('Username already taken');
        });
    });

    it('should fail with duplicate email', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'anotheruser',
          email: 'test_e2e@example.com',
          password: 'password123',
          confirmPassword: 'password123',
          referralCode: 'REFTEST1',
          language: 'en',
        })
        .expect(409)
        .expect((res) => {
          expect(res.body.message).toContain('Email already registered');
        });
    });
  });

  describe('POST /auth/login', () => {
    it('should fail with invalid credentials', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({
          username: 'nonexistent',
          password: 'wrongpassword',
        })
        .expect(401);
    });

    it('should fail with unverified email', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({
          username: 'testuser_e2e',
          password: 'password123',
        })
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toContain('verify your email');
        });
    });
  });

  describe('POST /auth/verify-email', () => {
    it('should fail with invalid code', () => {
      return request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({
          email: 'test_e2e@example.com',
          code: '000000',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain('Invalid or expired');
        });
    });
  });

  describe('POST /auth/resend-code', () => {
    it('should fail with non-existent email', () => {
      return request(app.getHttpServer())
        .post('/auth/resend-code')
        .send({
          email: 'nonexistent@example.com',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain('User not found');
        });
    });

    it('should resend code for unverified user', () => {
      return request(app.getHttpServer())
        .post('/auth/resend-code')
        .send({
          email: 'test_e2e@example.com',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.message).toContain('Verification code sent');
        });
    });
  });
});
