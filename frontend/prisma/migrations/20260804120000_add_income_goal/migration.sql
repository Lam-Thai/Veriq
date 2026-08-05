-- CreateEnum
CREATE TYPE "IncomeGoalType" AS ENUM ('MONTHLY_TARGET', 'RUNWAY_MONTHS', 'SAVINGS_TARGET');

-- CreateTable
CREATE TABLE "IncomeGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "IncomeGoalType" NOT NULL,
    "targetAmount" DECIMAL(10,2) NOT NULL,
    "monthlyExpenses" DECIMAL(10,2),
    "cashOnHand" DECIMAL(10,2),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "IncomeGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncomeGoal_userId_deletedAt_idx" ON "IncomeGoal"("userId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IncomeGoal_userId_type_key" ON "IncomeGoal"("userId", "type");

-- AddForeignKey
ALTER TABLE "IncomeGoal" ADD CONSTRAINT "IncomeGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
