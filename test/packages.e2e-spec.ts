import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { Decimal } from '@prisma/client/runtime/library';

describe('PackagesController (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let jwtService: JwtService;
  let testUser: any;
  let testPackage: any;
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
        username: 'pkg_e2e_test',
        email: 'pkg_e2e@test.com',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        referralCode: 'PKG12345',
        status: 'ACTIVE',
        emailVerified: true,
        balance: 5000,
      },
    });

    // Create test package
    testPackage = await prismaService.package.upsert({
      where: { name: 'E2E Test Package' },
      update: {},
      create: {
        name: 'E2E Test Package',
        durationDays: 30,
        dailyProfit: new Decimal(3.5),
        minAmount: new Decimal(100),
        maxAmount: new Decimal(10000),
        isActive: true,
      },
    });

    authToken = jwtService.sign({
      sub: testUser.id,
      email: testUser.email,
    });
  });

  afterAll(async () => {
    await prismaService.investment.deleteMany({
      where: { userId: testUser.id },
    });
    await prismaService.transaction.deleteMany({
      where: { userId: testUser.id },
    });
    await prismaService.user.delete({
      where: { id: testUser.id },
    });
    await prismaService.package.delete({
      where: { id: testPackage.id },
    });
    await app.close();
  });

  describe('GET /packages', () => {
    it('should return all active packages without authentication', () => {
      return request(app.getHttpServer())
        .get('/packages')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBeGreaterThan(0);
        });
    });
  });

  describe('GET /packages/:id', () => {
    it('should return package details', () => {
      return request(app.getHttpServer())
        .get(`/packages/${testPackage.id}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(testPackage.id);
          expect(res.body.name).toBe('E2E Test Package');
        });
    });

    it('should return 404 for non-existent package', () => {
      return request(app.getHttpServer())
        .get('/packages/non-existent-id')
        .expect(404);
    });
  });

  describe('POST /packages/invest', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .post('/packages/invest')
        .send({
          packageId: testPackage.id,
          amount: 500,
        })
        .expect(401);
    });

    it('should fail with amount below minimum', () => {
      return request(app.getHttpServer())
        .post('/packages/invest')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          packageId: testPackage.id,
          amount: 50,
        })
        .expect(400)
        .expect((res) => {
          // Validation error message from class-validator
          const messages = Array.isArray(res.body.message) ? res.body.message : [res.body.message];
          expect(messages.some((m: string) => m.toLowerCase().includes('amount') || m.toLowerCase().includes('less than'))).toBe(true);
        });
    });

    it('should fail with amount above maximum', () => {
      return request(app.getHttpServer())
        .post('/packages/invest')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          packageId: testPackage.id,
          amount: 50000,
        })
        .expect(400);
    });

    it('should create investment successfully', () => {
      return request(app.getHttpServer())
        .post('/packages/invest')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          packageId: testPackage.id,
          amount: 500,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.message).toContain('Investment created');
          expect(res.body.investment).toHaveProperty('id');
          expect(res.body.investment.packageName).toBe('E2E Test Package');
        });
    });

    it('should fail with insufficient balance', async () => {
      // Update user balance to 0
      await prismaService.user.update({
        where: { id: testUser.id },
        data: { balance: 0 },
      });

      return request(app.getHttpServer())
        .post('/packages/invest')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          packageId: testPackage.id,
          amount: 500,
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain('Insufficient balance');
        });
    });
  });

  describe('GET /packages/user/investments', () => {
    it('should return user investments', () => {
      return request(app.getHttpServer())
        .get('/packages/user/investments')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });
  });

  describe('GET /packages/user/active', () => {
    it('should return only active investments', () => {
      return request(app.getHttpServer())
        .get('/packages/user/active')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          res.body.forEach((inv: any) => {
            expect(inv.status).toBe('ACTIVE');
          });
        });
    });
  });
});
