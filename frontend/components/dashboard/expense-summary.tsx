import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { WalletIcon, DocumentIcon } from "@/components/ui/icons";
import { CalcMeter } from "@/components/dashboard/calc-meter";
import { formatUsdExact, formatUsdSafe } from "@/components/dashboard/calc-format";
import type { ExpenseSummary } from "@/lib/expense-calculators";

// Plain-language explanation of every derived figure, mirroring the Tax set-aside card's framing:
// informational planning estimates, never tax advice.
const HOW_WE_CALCULATED =
  "Net income is your verified income minus the expenses you've logged — monthly uses your average " +
  "monthly income against this month's expenses, and the yearly figure uses your annualized income " +
  "against the last 12 months of expenses. The estimated deductible total simply adds up the " +
  "expenses you've marked deductible, and the possible tax reduction applies a rule-of-thumb rate to " +
  "that total. These are budgeting estimates to help you plan — not tax advice, a tax filing, or a " +
  "guarantee any expense is deductible.";

type ExpenseSummaryCardsProps = {
  summary: ExpenseSummary;
};

/**
 * The derived-figures header of the Expenses tab: net (after-expense) income both monthly and
 * annualized, expense totals, and an estimated deductible total with a possible tax reduction.
 * Purely presentational — it renders synchronously from the server-computed `summary` its parent
 * already fetched, so it has no state variants of its own beyond what the parent panel handles.
 * Every figure is an informational estimate; the disclosure spells out how each is derived.
 */
export function ExpenseSummaryCards({ summary }: ExpenseSummaryCardsProps) {
  const hasVerifiedIncome = summary.averageMonthlyGross > 0 || summary.annualizedGross > 0;
  const deductibleSharePct = summary.windowTotal > 0 ? (summary.deductibleTotal / summary.windowTotal) * 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeading icon={<WalletIcon className="h-4 w-4 text-ink-muted-48" />} label="Net income" />
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <Figure label="This month" value={formatUsdSafe(summary.netMonthly)} hint="Avg. monthly income − this month's expenses" />
            <Figure label="This year" value={formatUsdSafe(summary.netAnnualized)} hint="Annualized income − last 12 months' expenses" />
          </dl>
          {!hasVerifiedIncome ? (
            <p className="mt-4 text-(length:--type-fine-print-size) text-ink-muted-48">
              Connect a platform on the Overview tab to see income-based net figures. Until then these show your
              expenses as a negative.
            </p>
          ) : null}
        </Card>

        <Card>
          <CardHeading icon={<DocumentIcon className="h-4 w-4 text-ink-muted-48" />} label="Expenses" />
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <Figure label="This month" value={formatUsdExact(summary.thisMonthTotal)} />
            <Figure label="Last 12 months" value={formatUsdExact(summary.windowTotal)} />
          </dl>
          {summary.byMonth.length > 0 ? (
            <dl className="mt-4 flex flex-col gap-2 border-t border-hairline pt-4">
              {summary.byMonth.slice(0, 4).map((month) => (
                <div key={month.key} className="flex items-baseline justify-between gap-4">
                  <dt className="text-(length:--type-fine-print-size) text-ink-muted-48">{month.label}</dt>
                  <dd className="text-(length:--type-caption-size) font-semibold text-ink">
                    {formatUsdExact(month.total)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </Card>

        <Card>
          <CardHeading icon={<DocumentIcon className="h-4 w-4 text-ink-muted-48" />} label="Deductions" />
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <Figure label="Deductible total" value={formatUsdExact(summary.deductibleTotal)} hint="Last 12 months" />
            <Figure
              label="Possible tax reduction"
              value={formatUsdSafe(summary.estimatedTaxSavings)}
              hint={`Estimated at ${summary.taxRatePct}%`}
            />
          </dl>
          <div className="mt-4">
            <CalcMeter valuePct={deductibleSharePct} />
            <p className="mt-2 text-(length:--type-fine-print-size) text-ink-muted-48">
              {Math.round(deductibleSharePct)}% of your last-12-months expenses are marked deductible.
            </p>
          </div>
        </Card>
      </div>

      <Disclosure>{HOW_WE_CALCULATED}</Disclosure>
    </div>
  );
}

function CardHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <p className="text-(length:--type-caption-size) font-semibold text-ink">{label}</p>
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-(length:--type-fine-print-size) text-ink-muted-48">{label}</dt>
      <dd className="mt-0.5 text-(length:--type-body-size) font-semibold text-ink">{value}</dd>
      {hint ? <p className="mt-0.5 text-(length:--type-fine-print-size) text-ink-muted-48">{hint}</p> : null}
    </div>
  );
}
