import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { ApiError } from "@/lib/api-error";
import { getUserConnections, type UserConnection } from "@/lib/dashboard-data";
import { findPlatformBySlug } from "@/components/landing/platform-data";
import { MONTHLY_BARS } from "@/components/ui/monthly-bar-chart";
import { ReportDocument, type ReportData, type ReportNarrative } from "@/lib/report-pdf";
import { generateIncomeNarrative } from "@/lib/ai/income-narrative";
import type { User } from "@clerk/nextjs/server";

// react-pdf's renderToBuffer and Prisma's pg driver adapter both need Node APIs (fontkit,
// streams, net/tls) — this route can never run on the Edge runtime.
export const runtime = "nodejs";

// `platformsParam` is a raw, client-supplied comma-separated string, so this only ever narrows
// `connections` (already scoped to the authed user) down by intersection — it can never widen
// the result to include another user's data.
function filterConnections(connections: UserConnection[], platformsParam: string | null): UserConnection[] {
  if (platformsParam === null) return connections;

  const requestedSlugs = new Set(
    platformsParam
      .split(",")
      .map((slug) => slug.trim())
      .filter(Boolean),
  );
  return connections.filter((connection) => requestedSlugs.has(connection.slug));
}

function buildReportData(clerkUser: User, connections: UserConnection[]): ReportData {
  const userName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    clerkUser.primaryEmailAddress?.emailAddress ||
    "Veriq user";

  const bySource = connections
    .map((connection) => ({
      name: findPlatformBySlug(connection.slug)?.name ?? connection.slug,
      amount: connection.verifiedAmount,
    }))
    .sort((a, b) => b.amount - a.amount);

  const totalVerified = connections.reduce((sum, connection) => sum + connection.verifiedAmount, 0);
  const rangeLabel = `${MONTHLY_BARS.at(0)!.month} – ${MONTHLY_BARS.at(-1)!.month} ${new Date().getFullYear()}`;

  return { generatedAt: new Date(), userName, rangeLabel, totalVerified, bySource };
}

/**
 * Renders and downloads the signed-in user's verified-income report as a PDF. An optional
 * `?platforms=slug1,slug2` query param (set by the report-builder UI) restricts which connected
 * platforms are included; omitting it — as the dashboard's quick-download link does — includes
 * all of the user's connections.
 */
export async function GET(request: NextRequest) {
  const clerkUser = await currentUser();
  if (!clerkUser) return ApiError.unauthorized();

  const connections = await getUserConnections(clerkUser.id);
  if (connections.length === 0) {
    return ApiError.conflict("NO_CONNECTIONS", "Connect at least one platform before generating a report.");
  }

  const platformsParam = request.nextUrl.searchParams.get("platforms");
  const selectedConnections = filterConnections(connections, platformsParam);
  if (selectedConnections.length === 0) {
    return ApiError.conflict("NO_PLATFORMS_SELECTED", "Select at least one platform to include in the report.");
  }

  const data = buildReportData(clerkUser, selectedConnections);

  // Additive only: the income-narrative service (lib/ai/income-narrative.ts) always summarizes
  // the user's full set of verified connections, not just `selectedConnections` — it's scoped to
  // a userId, not an arbitrary platform subset (see that file's IDOR-safety comment), and it's
  // also the same cached-per-user row the dashboard card reads, so summarizing a different
  // subset here would mean maintaining a second cache keyed by platform selection. A failed,
  // slow, or rate-limited call must never block the PDF download, so this is wrapped in its own
  // try/catch and left undefined (report renders without the AI section) on any failure —
  // generateIncomeNarrative itself already never throws, but this belongs to the caller's
  // contract, not something route.tsx should assume holds forever.
  //
  // Only attach it when the user didn't filter the report down to a subset: the narrative always
  // describes the full connection set, so pairing it with a report whose totals/by-source table
  // reflect a smaller, hand-picked selection would show numbers and prose that describe two
  // different datasets in the same lender-facing document — worse than just omitting the summary.
  let narrative: ReportNarrative | undefined;
  const isFullSelection = selectedConnections.length === connections.length;
  if (isFullSelection) {
    try {
      const narrativeResult = await generateIncomeNarrative(clerkUser.id);
      if (narrativeResult.status === "ok") {
        narrative = {
          text: narrativeResult.data.narrative,
          stabilityRating: narrativeResult.data.stabilityRating,
          trendDirection: narrativeResult.data.trendDirection,
          diversificationSummary: narrativeResult.data.diversificationSummary,
        };
      }
    } catch (err) {
      console.error("[report] income narrative unavailable, rendering report without it", err);
    }
  }

  if (narrative) data.narrative = narrative;

  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(<ReportDocument data={data} />);
  } catch (err) {
    console.error("[report] failed to render PDF", err);
    return ApiError.internal();
  }

  const filename = `veriq-verified-income-report-${new Date().toISOString().slice(0, 10)}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
