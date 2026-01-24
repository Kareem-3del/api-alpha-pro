import { User, Wallet } from '@prisma/client';

export type AuthenticatedUser = User & {
  wallet: Wallet | null;
};
