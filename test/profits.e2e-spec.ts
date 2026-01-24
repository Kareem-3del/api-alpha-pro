import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { Decimal } from '@prisma/client/runtime/library';

describe('ProfitsController (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let jwtService: JwtService;
  let testUser: any;
  let testPackage: any;
  let testInvestment: any;
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
        username: 'profits_e2e_test',
        email: 'profits_e2e@test.com',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        referralCode: 'PROF1234',
        status: 'ACTIVE',
        emailVerified: true,
        balance: 1000,
      },
    });

    // Create test package
    testPackage = await prismaService.package.upsert({
      where: { name: 'Profits E2E Package' },
      update: {},
      create: {
        name: 'Profits E2E Package',
        durationDays: 30,
        dailyProfit: new Decimal(3.5),
        minAmount: new Decimal(100),
        maxAmount: new Decimal(10000),
        isActive: true,
      },
    });

    // Create test investment
    testInvestment = await prismaService.investment.create({
      data: {
        userId: testUser.id,
        packageId: testPackage.id,
        amount: new Decimal(1000),
        dailyProfit: new Decimal(3.5),
        totalProfit: new Decimal(70),
        status: 'ACTIVE',
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    // Create profit records
    await prismaService.profitRecord.createMany({
      data: [
        {
          userId: testUser.id,
          investmentId: testInvestment.id,
          amount: new Decimal(35),
          profitDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
        {
          userId: testUser.id,
          investmentId: testInvestment.id,
          amount: new Decimal(35),
          profitDate: new Date(),
        },
      ],
    });

    // Create team bonus
    await prismaService.teamBonus.create({
      data: {
        userId: testUser.id,
        fromUserId: testUser.id,
        level: 1,
        percentage: new Decimal(10),
        amount: new Decimal(10),
        bonusDate: new Date(),
      },
    });

    // Create weekly salary
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    const weekEnd = new Date();

    await prismaService.weeklySalary.create({
      data: {
        userId: testUser.id,
        referralCount: 15,
        amount: new Decimal(30),
        weekStart,
        weekEnd,
      },
    });

    authToken = jwtService.sign({
      sub: testUser.id,
      email: testUser.email,
    });
  });

  afterAll(async () => {
    await prismaService.profitRecord.deleteMany({
      where: { userId: testUser.id },
    });
    await prismaService.teamBonus.deleteMany({
      where: { userId: testUser.id },
    });
    await prismaService.weeklySalary.deleteMany({
      where: { userId: testUser.id },
    });
    await prismaService.investment.deleteMany({
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

  describe('GET /profits/history', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/profits/history')
        .expect(401);
    });

    it('should return profit history', () => {
      return request(app.getHttpServer())
        .get('/profits/history')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBe(2);
          expect(res.body[0]).toHaveProperty('amount');
          expect(res.body[0]).toHaveProperty('profitDate');
          expect(res.body[0]).toHaveProperty('investment');
        });
    });
  });

  describe('GET /profits/team-bonuses', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/profits/team-bonuses')
        .expect(401);
    });

    it('should return team bonus history', () => {
      return request(app.getHttpServer())
        .get('/profits/team-bonuses')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBe(1);
          expect(res.body[0]).toHaveProperty('amount');
          expect(res.body[0]).toHaveProperty('level');
          expect(res.body[0]).toHaveProperty('percentage');
        });
    });
  });

  describe('GET /profits/weekly-salary', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/profits/weekly-salary')
        .expect(401);
    });

    it('should return weekly salary history', () => {
      return request(app.getHttpServer())
        .get('/profits/weekly-salary')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBe(1);
          expect(res.body[0]).toHaveProperty('amount');
          expect(res.body[0]).toHaveProperty('referralCount');
          expect(res.body[0]).toHaveProperty('weekStart');
          expect(res.body[0]).toHaveProperty('weekEnd');
        });
    });
  });

  // Note: Daily/Weekly profit distribution is handled by cron jobs, not API endpoints
});
