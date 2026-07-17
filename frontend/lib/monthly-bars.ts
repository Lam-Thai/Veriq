// Jan–Jun, relative bar heights (percent of track) — June is the "current" highlighted month.
// Shared by the hero/dashboard mockups (MonthlyBarChart), server-side report data
// (dashboard-data.ts), and the PDF report route — kept in a plain module (not the "use client"
// MonthlyBarChart component) so server code can import the data without pulling in client refs.
export const MONTHLY_BARS = [
  { month: "Jan", heightPct: 58 },
  { month: "Feb", heightPct: 64 },
  { month: "Mar", heightPct: 70 },
  { month: "Apr", heightPct: 66 },
  { month: "May", heightPct: 78 },
  { month: "Jun", heightPct: 100 },
];

export type Bar = { month: string; heightPct: number };
