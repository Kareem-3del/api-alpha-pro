-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USDT',
ADD COLUMN     "depositWalletId" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DepositWallet" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "network" "WalletNetwork" NOT NULL,
    "derivationIndex" INTEGER NOT NULL,
    "webhookId" TEXT,
    "assignedToUserId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "totalDeposits" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositWallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DepositWallet_address_key" ON "DepositWallet"("address");

-- CreateIndex
CREATE INDEX "DepositWallet_network_isAvailable_idx" ON "DepositWallet"("network", "isAvailable");

-- CreateIndex
CREATE INDEX "DepositWallet_address_idx" ON "DepositWallet"("address");

-- CreateIndex
CREATE INDEX "DepositWallet_assignedToUserId_idx" ON "DepositWallet"("assignedToUserId");

-- CreateIndex
CREATE INDEX "DepositWallet_expiresAt_idx" ON "DepositWallet"("expiresAt");

-- CreateIndex
CREATE INDEX "Deposit_depositWalletId_idx" ON "Deposit"("depositWalletId");
