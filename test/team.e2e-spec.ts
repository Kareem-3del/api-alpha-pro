import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { Decimal } from '@prisma/client/runtime/library';

describe('TeamController (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let jwtService: JwtService;
  let testUser: any;
  let referral1: any;
  let referral2: any;
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
        username: 'team_e2e_test',
        email: 'team_e2e@test.com',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        referralCode: 'TEAM1234',
        status: 'ACTIVE',
        emailVerified: true,
        totalTeamEarnings: 250,
      },
    });

    // Create referrals
    referral1 = await prismaService.user.create({
      data: {
        username: 'team_ref1_e2e',
        email: 'team_ref1_e2e@test.com',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        referralCode: 'TEAMR101',
        status: 'ACTIVE',
        emailVerified: true,
        referredBy: testUser.id,
        totalDeposits: 1000,
      },
    });

    referral2 = await prismaService.user.create({
      data: {
        username: 'team_ref2_e2e',
        email: 'team_ref2_e2e@test.com',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        referralCode: 'TEAMR201',
        status: 'ACTIVE',
        emailVerified: true,
        referredBy: testUser.id,
        totalDeposits: 2000,
      },
    });

    // Create team bonuses
    await prismaService.teamBonus.createMany({
      data: [
        {
          userId: testUser.id,
          fromUserId: referral1.id,
          level: 1,
          percentage: new Decimal(10),
          amount: new Decimal(100),
          bonusDate: new Date(),
        },
        {
          userId: testUser.id,
          fromUserId: referral2.id,
          level: 1,
          percentage: new Decimal(10),
          amount: new Decimal(150),
          bonusDate: new Date(),
        },
      ],
    });

    authToken = jwtService.sign({
      sub: testUser.id,
      email: testUser.email,
    });
  });

  afterAll(async () => {
    await prismaService.teamBonus.deleteMany({
      where: { userId: testUser.id },
    });
    await prismaService.weeklySalary.deleteMany({
      where: { userId: testUser.id },
    });
    await prismaService.user.deleteMany({
      where: { id: { in: [testUser.id, referral1.id, referral2.id] } },
    });
    await app.close();
  });

  describe('GET /team/earnings', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/team/earnings')
        .expect(401);
    });

    it('should return team earnings summary', () => {
      return request(app.getHttpServer())
        .get('/team/earnings')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('totalTeamEarnings');
          expect(res.body.level1).toHaveProperty('percentage', 10);
          expect(res.body.level2).toHaveProperty('percentage', 5);
          expect(res.body).toHaveProperty('weeklySalary');
          expect(res.body).toHaveProperty('recentBonuses');
          expect(res.body.recentBonuses.length).toBe(2);
        });
    });
  });

  describe('GET /team/levels', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/team/levels')
        .expect(401);
    });

    it('should return team levels with member details', () => {
      return request(app.getHttpServer())
        .get('/team/levels')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.level1.count).toBe(2);
          expect(res.body.level1.totalDeposits).toBe(3000); // 1000 + 2000
          expect(res.body.level1.members.length).toBe(2);
          expect(res.body.level2.count).toBe(0);
          expect(res.body.totalTeamSize).toBe(2);
          expect(res.body.totalTeamDeposits).toBe(3000);
        });
    });
  });

  describe('GET /team/salary', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/team/salary')
        .expect(401);
    });

    it('should return weekly salary information', () => {
      return request(app.getHttpServer())
        .get('/team/salary')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('currentReferrals', 2);
          expect(res.body).toHaveProperty('currentWeeklySalary', 0); // Less than 10 referrals
          expect(res.body.nextTier).toEqual({ referrals: 10, salary: 30 });
          expect(res.body).toHaveProperty('referralsNeeded', 8);
          expect(res.body.salaryTiers).toHaveLength(4);
          expect(res.body).toHaveProperty('history');
        });
    });
  });
});
