import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('ReferralsController (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let jwtService: JwtService;
  let parentUser: any;
  let childUser1: any;
  let childUser2: any;
  let grandchildUser: any;
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

    // Create parent user (the one we'll test with)
    parentUser = await prismaService.user.create({
      data: {
        username: 'ref_parent_e2e',
        email: 'ref_parent_e2e@test.com',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        referralCode: 'REFPAR01',
        status: 'ACTIVE',
        emailVerified: true,
        balance: 1000,
        totalTeamEarnings: 500,
      },
    });

    // Create level 1 referrals
    childUser1 = await prismaService.user.create({
      data: {
        username: 'ref_child1_e2e',
        email: 'ref_child1_e2e@test.com',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        referralCode: 'REFCH101',
        status: 'ACTIVE',
        emailVerified: true,
        referredBy: parentUser.id,
        totalDeposits: 500,
      },
    });

    childUser2 = await prismaService.user.create({
      data: {
        username: 'ref_child2_e2e',
        email: 'ref_child2_e2e@test.com',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        referralCode: 'REFCH201',
        status: 'ACTIVE',
        emailVerified: true,
        referredBy: parentUser.id,
        totalDeposits: 1000,
      },
    });

    // Create level 2 referral (grandchild)
    grandchildUser = await prismaService.user.create({
      data: {
        username: 'ref_grandchild_e2e',
        email: 'ref_grandchild_e2e@test.com',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        referralCode: 'REFGC001',
        status: 'ACTIVE',
        emailVerified: true,
        referredBy: childUser1.id,
        totalDeposits: 300,
      },
    });

    authToken = jwtService.sign({
      sub: parentUser.id,
      email: parentUser.email,
    });
  });

  afterAll(async () => {
    await prismaService.user.deleteMany({
      where: {
        id: { in: [parentUser.id, childUser1.id, childUser2.id, grandchildUser.id] },
      },
    });
    await app.close();
  });

  describe('GET /referrals/code', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/referrals/code')
        .expect(401);
    });

    it('should return user referral code', () => {
      return request(app.getHttpServer())
        .get('/referrals/code')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.referralCode).toBe('REFPAR01');
        });
    });
  });

  describe('GET /referrals', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/referrals')
        .expect(401);
    });

    it('should return list of direct referrals', () => {
      return request(app.getHttpServer())
        .get('/referrals')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBe(2);
          expect(res.body.map((r: any) => r.username)).toContain('ref_child1_e2e');
          expect(res.body.map((r: any) => r.username)).toContain('ref_child2_e2e');
        });
    });
  });

  describe('GET /referrals/stats', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/referrals/stats')
        .expect(401);
    });

    it('should return comprehensive referral statistics', () => {
      return request(app.getHttpServer())
        .get('/referrals/stats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.referralCode).toBe('REFPAR01');
          expect(res.body.level1Count).toBe(2);
          expect(res.body.level2Count).toBe(1);
          expect(res.body.totalTeamSize).toBe(3);
          expect(res.body.totalTeamDeposits).toBe(1500); // 500 + 1000
          expect(res.body).toHaveProperty('totalReferralBonuses');
          expect(res.body).toHaveProperty('totalTeamCommissions');
        });
    });
  });

  describe('GET /referrals/tree', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/referrals/tree')
        .expect(401);
    });

    it('should return hierarchical team tree', () => {
      return request(app.getHttpServer())
        .get('/referrals/tree')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBe(2); // 2 level 1 referrals

          // Find child1 and check their children
          const child1 = res.body.find((r: any) => r.username === 'ref_child1_e2e');
          expect(child1).toBeDefined();
          expect(child1.level).toBe(1);
          expect(child1.children.length).toBe(1);
          expect(child1.children[0].username).toBe('ref_grandchild_e2e');
          expect(child1.children[0].level).toBe(2);
        });
    });

    // Note: depth parameter is not currently exposed via the API endpoint
    // The controller uses a fixed depth of 2
    it('should return full tree with default depth of 2', () => {
      return request(app.getHttpServer())
        .get('/referrals/tree')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          const child1 = res.body.find((r: any) => r.username === 'ref_child1_e2e');
          // API returns children with default depth=2
          expect(child1).toBeDefined();
          expect(child1.children.length).toBe(1);
        });
    });
  });
});
