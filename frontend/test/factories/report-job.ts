import type { Prisma } from "@/lib/generated/prisma/client";
import { ReportJobStatus } from "@/lib/generated/prisma/enums";
import { testDb } from "@/test/helpers/db";

/**
 * Small non-empty placeholder PDF bytes — never real rendered report content. A READY job's
 * `pdfData` being null/missing is treated as a data-integrity bug, not an expected state, by both
 * the owner-facing GET /api/report/[jobId] route and the public download route
 * (app/api/verify/[token]/download/route.ts:71-74 logs and 404s on exactly this), so every READY
 * fixture needs *some* bytes here or those routes' happy paths can't be exercised.
 */
const PLACEHOLDER_PDF_DATA = new Uint8Array(Buffer.from("%PDF-1.4 test fixture placeholder\n", "utf-8"));

export type CreateTestReportJobOverrides = Partial<
  Pick<Prisma.ReportJobUncheckedCreateInput, "status" | "platformsParam" | "pdfData" | "filename" | "error">
>;

/**
 * Inserts a `ReportJob` row directly, defaulting to `READY` with placeholder PDF bytes — the
 * state every sharing test needs as its starting point, since `createShareIfAllowed`
 * (lib/report-shares.ts) only ever mints a share against a `READY` job. Pass `overrides` to build
 * a non-READY fixture for a case that specifically needs one (e.g. asserting share creation is
 * refused against a PENDING job).
 */
export async function createTestReportJob(
  userId: string,
  overrides: CreateTestReportJobOverrides = {},
): Promise<{ id: string }> {
  const job = await testDb.reportJob.create({
    data: {
      userId,
      status: ReportJobStatus.READY,
      pdfData: PLACEHOLDER_PDF_DATA,
      filename: "test-report.pdf",
      ...overrides,
    },
    select: { id: true },
  });

  return { id: job.id };
}
