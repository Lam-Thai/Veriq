import { db } from "@/lib/db";
import { MONTHLY_BARS } from "@/lib/monthly-bars";
import { computeAverageMonthly, distributeAcrossMonths, toBarHeights, type MonthlyAmount } from "@/lib/income-math";

// Re-exported so existing importers (overview-panel.tsx, advisor-insights.ts,
// lib/ai/income-narrative.ts) don't need to change — the pure math itself lives in
// lib/income-math.ts so report-builder.tsx (a client component) can import it directly without
// pulling this file's `db` import into the client bundle.
export { distributeAcrossMonths, toBarHeights, type MonthlyAmount };

export type UserConnection = {
  slug: string;
  verifiedAmount: number;
  connectedAt: Date;
};

/**
 * A signed-in user with no `User` row yet (never completed a connect flow) simply has zero
 * connections — this is a read-only lookup, not an upsert, so viewing the dashboard never writes
 * to the database.
 */
export async function getUserConnections(clerkId: string): Promise<UserConnection[]> {
  const user = await db.user.findUnique({ where: { clerkId }, select: { id: true } });
  if (!user) return [];

  const connections = await db.platformConnection.findMany({
    where: { userId: user.id },
    select: { slug: true, verifiedAmount: true, connectedAt: true },
    orderBy: { connectedAt: "asc" },
  });

  return connections.map((connection) => ({
    slug: connection.slug,
    verifiedAmount: connection.verifiedAmount.toNumber(),
    connectedAt: connection.connectedAt,
  }));
}

export type DashboardStats = {
  totalVerified: number;
  thisMonth: number;
  averageMonthly: number;
  monthlyBreakdown: MonthlyAmount[];
};

export function computeDashboardStats(connections: UserConnection[]): DashboardStats {
  const totalVerified = connections.reduce((sum, connection) => sum + connection.verifiedAmount, 0);

  const monthlyBreakdown = MONTHLY_BARS.map((bar) => ({ month: bar.month, amount: 0 }));
  for (const connection of connections) {
    const distribution = distributeAcrossMonths(connection.verifiedAmount);
    distribution.forEach((entry, index) => {
      monthlyBreakdown[index]!.amount += entry.amount;
    });
  }

  const thisMonth = monthlyBreakdown.at(-1)?.amount ?? 0;
  const averageMonthly = computeAverageMonthly(totalVerified);

  return { totalVerified, thisMonth, averageMonthly, monthlyBreakdown };
}
