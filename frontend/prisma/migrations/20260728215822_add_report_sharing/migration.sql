-- CreateTable
CREATE TABLE "ReportShare" (
    "id" TEXT NOT NULL,
    "reportJobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstViewedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ReportShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportShareView" (
    "id" TEXT NOT NULL,
    "reportShareId" TEXT NOT NULL,
    "viewedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" VARCHAR(64),
    "userAgent" VARCHAR(300),

    CONSTRAINT "ReportShareView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportShare_tokenHash_key" ON "ReportShare"("tokenHash");

-- CreateIndex
CREATE INDEX "ReportShare_userId_createdAt_idx" ON "ReportShare"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ReportShare_reportJobId_revokedAt_expiresAt_idx" ON "ReportShare"("reportJobId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "ReportShareView_reportShareId_viewedAt_idx" ON "ReportShareView"("reportShareId", "viewedAt" DESC);

-- AddForeignKey
ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_reportJobId_fkey" FOREIGN KEY ("reportJobId") REFERENCES "ReportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportShareView" ADD CONSTRAINT "ReportShareView_reportShareId_fkey" FOREIGN KEY ("reportShareId") REFERENCES "ReportShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;
