-- CreateTable
CREATE TABLE "IncomeNarrative" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "stabilityRating" TEXT NOT NULL,
    "trendDirection" TEXT NOT NULL,
    "diversificationSummary" TEXT NOT NULL,
    "notableObservations" TEXT[],
    "inputHash" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeNarrative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncomeNarrative_userId_key" ON "IncomeNarrative"("userId");

-- CreateIndex
CREATE INDEX "IncomeNarrative_userId_idx" ON "IncomeNarrative"("userId");

-- AddForeignKey
ALTER TABLE "IncomeNarrative" ADD CONSTRAINT "IncomeNarrative_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
