# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Production Constraints

This is a **live production application**. Zero downtime is required — never stop the app for extended periods. Always use `pm2 reload api-alpha-pro` (not restart) for graceful zero-downtime deployments. The app runs on port 4000.

## Common Commands

```bash
# Development
npm run start:dev          # Watch mode with auto-reload
npm run build              # Compile TypeScript to dist/

# Production (PM2)
pm2 reload api-alpha-pro   # Zero-downtime reload (ALWAYS use this, not restart)
pm2 logs api-alpha-pro     # View logs
pm2 show api-alpha-pro     # Process details

# Database
npx prisma migrate dev     # Create/apply migration in dev
npx prisma db push         # Push schema changes without migration
npx prisma generate        # Regenerate Prisma client after schema changes
npx prisma db seed         # Seed database
npm run db:setup           # Full setup: generate + migrate + seed

# Testing
npm run test               # Unit tests (Jest)
npm run test:e2e           # E2E tests (in test/*.e2e-spec.ts)
npm run test -- --testPathPattern=<pattern>  # Run single test file

# Code Quality
npm run lint               # ESLint with auto-fix
npm run format             # Prettier formatting
```

## Architecture

**Stack**: NestJS 11 + TypeScript + PostgreSQL + Prisma ORM + PM2

**API prefix**: All routes are under `/api` (set globally in `main.ts`).

### Module Structure (src/)

Each feature module follows the NestJS pattern: `module.ts`, `service.ts`, `controller.ts`, `dto/`.

| Module | Purpose |
|--------|---------|
| `auth/` | Registration, login (email/username), JWT tokens (access+refresh), email verification, password reset |
| `users/` | Profile, dashboard stats, withdrawal PIN management |
| `wallet/` | User wallet linking and verification |
| `deposits/` | Deposit processing with wallet pool system (`wallet-pool.service.ts`) |
| `withdrawals/` | Withdrawal requests with network-specific fees |
| `packages/` | Investment packages (Bronze/Silver/Gold/Testing) |
| `profits/` | Daily profit calculation and distribution across investments |
| `referrals/` | Referral tracking and bonus distribution |
| `team/` | 2-level commission structure (10% L1, 5% L2) |
| `transactions/` | Transaction history with filtering |
| `prices/` | Cryptocurrency price feeds |
| `email/` | SMTP email via Hostinger |
| `tatum/` | Tatum blockchain API integration (BSC/Tron) |
| `admin/` | Admin-only management endpoints |

### Shared Code (`src/common/`)

- `guards/`: `JwtAuthGuard` (authentication), `AdminGuard` (admin-only)
- `decorators/`: `@CurrentUser()` extracts user from JWT
- `utils/crypto.util.ts`: AES-256-GCM encryption for wallet private keys (PBKDF2 key derivation)

### Database

Schema is in `prisma/schema.prisma`. Key models: User, Wallet, Investment, Transaction, Deposit, Withdrawal, DepositWallet, ProfitRecord, TeamBonus, WeeklySalary, VerificationCode, Package, SystemConfig.

Migrations are versioned in `prisma/migrations/`. Seed script is `prisma/seed.ts`.

### Authentication Flow

JWT-based with Passport.js. Access tokens (30d) + refresh tokens (90d). Email verification required before login. Guards protect endpoints: `@UseGuards(JwtAuthGuard)` and `@UseGuards(AdminGuard)`.

### Wallet Pool System

HD wallet derivation generates deposit addresses from xpub. Wallets are assigned to users for 1-hour windows (LRU selection). Tatum webhooks monitor incoming deposits. Private keys are encrypted with AES-256-GCM before storage.

### Deployment

CI/CD via GitHub Actions (`.github/workflows/deploy.yml`): push to `main` → SSH → pull → install → build → `pm2 reload`. PM2 config in `ecosystem.config.js` (1 instance, 1GB memory limit, graceful reload).
