-- DropIndex
DROP INDEX "IncomeNarrative_userId_idx";

-- AlterTable
ALTER TABLE "IncomeNarrative" ALTER COLUMN "generatedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);
