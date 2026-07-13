import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { ApiError } from "@/lib/api-error";
import { getUserConnections, type UserConnection } from "@/lib/dashboard-data";
import { findPlatformBySlug } from "@/components/landing/platform-data";
import { MONTHLY_BARS } from "@/components/ui/monthly-bar-chart";
import { ReportDocument, type ReportData } from "@/lib/report-pdf";
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
