-- DropIndex
DROP INDEX "ReportJob_userId_idx";

-- CreateIndex
CREATE INDEX "ReportJob_userId_status_createdAt_idx" ON "ReportJob"("userId", "status", "createdAt" DESC);
