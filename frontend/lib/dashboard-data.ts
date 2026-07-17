import { db } from "@/lib/db";
import { MONTHLY_BARS } from "@/lib/monthly-bars";

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

export type MonthlyAmount = { month: string; amount: number };

// Normalizes the shared MONTHLY_BARS curve (relative bar heights, e.g. June's 100 = "current,
// full height") into weights that sum to 1, then spreads `total` across those weights. Every
// connected platform's verifiedAmount is distributed with this same curve — this repo has no
// real per-month transaction data (real OAuth is out of scope), so re-deriving a plausible trend
// from the one number we do have (the total) is preferable to inventing a second, disconnected
// fake-data source.
export function distributeAcrossMonths(total: number): MonthlyAmount[] {
  const weightSum = MONTHLY_BARS.reduce((sum, bar) => sum + bar.heightPct, 0);
  return MONTHLY_BARS.map((bar) => ({
    month: bar.month,
    amount: (total * bar.heightPct) / weightSum,
  }));
}

// Normalizes computed monthly amounts into the 0-100 heightPct scale MonthlyBarChart expects
// (tallest month = 100). All-zero months (a brand-new user with no connections) render as flat
// empty bars rather than dividing by zero.
export function toBarHeights(monthlyBreakdown: MonthlyAmount[]): { month: string; heightPct: number }[] {
  const max = Math.max(0, ...monthlyBreakdown.map((entry) => entry.amount));
  return monthlyBreakdown.map((entry) => ({
    month: entry.month,
    heightPct: max > 0 ? (entry.amount / max) * 100 : 0,
  }));
}

export type DashboardStats = {
  totalVerified: number;
  thisMonth: number;
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

  return { totalVerified, thisMonth, monthlyBreakdown };
}
