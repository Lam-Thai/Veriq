"use client";

import { useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { PillButton } from "@/components/ui/pill-button";
import { SpinnerIcon } from "@/components/ui/icons";
import { CalcField } from "@/components/dashboard/calc-field";
import { CalcMeter } from "@/components/dashboard/calc-meter";
import { formatPercent, formatUsdExact, formatUsdSafe } from "@/components/dashboard/calc-format";
import { isErrorEnvelope } from "@/lib/error-envelope";
import { MAX_GOAL_AMOUNT, DIP_THRESHOLD_PCT, type IncomeGoalDto } from "@/lib/goals";
import {
  computeAttainmentHistory,
  computeDipAlert,
  computeGoalProgress,
  computeRunway,
  type MonthAttainment,
  type RunwayEstimate,
} from "@/lib/goal-calculators";
import type { MonthlyAmount } from "@/lib/income-math";

type GoalsPanelProps = {
  /** The user's active monthly-income goal, or null when they haven't set one. */
  goal: IncomeGoalDto | null;
  /** Verified income spread across months — see the honesty caveat in lib/goal-calculators.ts. */
  monthlyBreakdown: MonthlyAmount[];
  /** Average monthly verified income (the Overview tab's figure). */
  averageMonthly: number;
  /** True once the user has any verified income at all. */
  hasVerifiedIncome: boolean;
  /** Average monthly expenses derived from the user's logged expenses; 0 when they've logged none. */
  loggedMonthlyExpenses: number;
};

type FormStatus = "idle" | "saving" | "error";

/** Blank string ⇒ the field is unset (null), not zero — the two mean different things here. */
function parseOptional(input: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_GOAL_AMOUNT) return { ok: false };
  return { ok: true, value: Math.round(parsed * 100) / 100 };
}

function toFieldValue(amount: number | null): string {
  return amount === null ? "" : String(amount);
}

/**
 * Narrows a `{ data }` success envelope to a goal before the panel trusts it — the mirror image of
 * lib/error-envelope.ts's isErrorEnvelope, checking the two fields every render path depends on.
 */
function isGoalEnvelope(value: unknown): value is { data: IncomeGoalDto } {
  if (typeof value !== "object" || value === null || !("data" in value)) return false;
  const { data } = value as { data: unknown };
  if (typeof data !== "object" || data === null) return false;
  return (
    "id" in data &&
    typeof (data as { id: unknown }).id === "string" &&
    "targetAmount" in data &&
    typeof (data as { targetAmount: unknown }).targetAmount === "number"
  );
}

/**
 * "Goals" tab body — set a monthly income goal, then see how the current verified month tracks
 * against it, how long a cash buffer would cover expenses, and which months hit the goal.
 *
 * Every number here is an informational planning estimate assembled from verified income plus
 * figures the user typed in: never a forecast, a guarantee, or financial advice. Two honesty
 * constraints the copy holds to, both inherited from lib/goal-calculators.ts:
 *   - Per-month income is a modelled distribution of verified totals (lib/monthly-bars.ts), not a
 *     record of what landed in the user's account. Attainment copy says so plainly.
 *   - Runway in months is only shown once the user states a cash buffer. Without one we show the
 *     expense-coverage multiple instead and name it as such, rather than passing one off as the other.
 *
 * Covers all four state variants: empty (an invitation to set a first goal), loading (busy save/clear
 * controls), error (inline, with the form's values preserved so nothing is retyped), and populated.
 */
export function GoalsPanel({
  goal: initialGoal,
  monthlyBreakdown,
  averageMonthly,
  hasVerifiedIncome,
  loggedMonthlyExpenses,
}: GoalsPanelProps) {
  const router = useRouter();

  // Server truth, mirrored locally so a save/clear reflects immediately rather than waiting on
  // router.refresh(). When the server prop itself changes (the refresh landing, or another tab's
  // edit) it wins — React's documented "adjust state when a prop changes" idiom.
  //
  // ExpensesPanel deliberately doesn't do this and the difference is not accidental: its mutations
  // re-fetch the list from /api/expenses, so local state is already authoritative. This panel has no
  // list to re-fetch — the goal arrives only as a server prop — so without the mirror, a saved goal
  // would visibly lag until router.refresh() resolved.
  const [serverGoal, setServerGoal] = useState(initialGoal);
  const [goal, setGoal] = useState(initialGoal);
  if (serverGoal !== initialGoal) {
    setServerGoal(initialGoal);
    setGoal(initialGoal);
  }

  const [formOpen, setFormOpen] = useState(false);
  const [status, setStatus] = useState<FormStatus>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);

  const [targetInput, setTargetInput] = useState("");
  const [expensesInput, setExpensesInput] = useState("");
  const [cashInput, setCashInput] = useState("");

  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const [announcement, setAnnouncement] = useState("");

  const targetRef = useRef<HTMLInputElement>(null);

  function openForm() {
    setTargetInput(goal ? String(goal.targetAmount) : "");
    // Prefill expenses from the user's real logged expenses when they haven't overridden them, so
    // the runway estimate is useful without retyping what the Expenses tab already knows.
    setExpensesInput(
      goal?.monthlyExpenses != null
        ? String(goal.monthlyExpenses)
        : loggedMonthlyExpenses > 0
          ? String(loggedMonthlyExpenses)
          : "",
    );
    setCashInput(toFieldValue(goal?.cashOnHand ?? null));
    setTargetError(null);
    setFormError(null);
    setStatus("idle");
    // Opening the form hides the clear controls, so disarm them here too — otherwise cancelling the
    // form would put a still-armed "Confirm clear" (and any stale clear error) back on screen, one
    // click from a destructive action the user had visually moved on from.
    setConfirmingClear(false);
    setClearError(null);
    setFormOpen(true);
  }

  async function saveGoal() {
    const target = Number.parseFloat(targetInput.trim());
    if (!Number.isFinite(target) || target <= 0) {
      setTargetError("Enter a monthly goal greater than $0.");
      targetRef.current?.focus();
      return;
    }
    if (target > MAX_GOAL_AMOUNT) {
      setTargetError("That goal is too large.");
      targetRef.current?.focus();
      return;
    }

    const expenses = parseOptional(expensesInput);
    const cash = parseOptional(cashInput);
    if (!expenses.ok || !cash.ok) {
      setFormError("Monthly expenses and savings must be $0 or more.");
      return;
    }

    setTargetError(null);
    setFormError(null);
    setStatus("saving");

    try {
      const response = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "MONTHLY_TARGET",
          targetAmount: Math.round(target * 100) / 100,
          monthlyExpenses: expenses.value,
          cashOnHand: cash.value,
        }),
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setFormError(isErrorEnvelope(body) ? body.error.message : "Couldn't save your goal.");
        setStatus("error");
        return;
      }

      // A 2xx with a body we can't read as a goal is still a failure from the user's point of view.
      // Without this check the bare cast would hand `undefined` to setGoal and silently drop the
      // panel back to its empty state even though the write succeeded.
      if (!isGoalEnvelope(body)) {
        setFormError("Couldn't save your goal.");
        setStatus("error");
        return;
      }

      setGoal(body.data);
      setFormOpen(false);
      setStatus("idle");
      setAnnouncement("Goal saved");
      router.refresh();
    } catch {
      setFormError("Couldn't save your goal.");
      setStatus("error");
    }
  }

  async function clearGoal() {
    if (!goal) return;
    setClearing(true);
    setClearError(null);
    try {
      const response = await fetch(`/api/goals/${goal.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setClearError(isErrorEnvelope(body) ? body.error.message : "Couldn't clear your goal.");
        return;
      }
      setGoal(null);
      setConfirmingClear(false);
      setAnnouncement("Goal cleared");
      router.refresh();
    } catch {
      setClearError("Couldn't clear your goal.");
    } finally {
      setClearing(false);
    }
  }

  const progress = goal ? computeGoalProgress(goal.targetAmount, monthlyBreakdown) : null;
  const attainment = goal ? computeAttainmentHistory(goal.targetAmount, monthlyBreakdown) : null;
  const dip = hasVerifiedIncome ? computeDipAlert(goal?.targetAmount ?? null, monthlyBreakdown) : null;
  const runway = computeRunway({
    averageMonthlyIncome: averageMonthly,
    monthlyExpensesOverride: goal?.monthlyExpenses ?? null,
    loggedMonthlyExpenses,
    cashOnHand: goal?.cashOnHand ?? null,
  });

  const goalForm = formOpen ? (
    <GoalForm
      targetRef={targetRef}
      targetInput={targetInput}
      expensesInput={expensesInput}
      cashInput={cashInput}
      onTargetChange={setTargetInput}
      onExpensesChange={setExpensesInput}
      onCashChange={setCashInput}
      targetError={targetError}
      formError={formError}
      saving={status === "saving"}
      isEdit={goal !== null}
      prefilledFromExpenses={goal?.monthlyExpenses == null && loggedMonthlyExpenses > 0}
      onSave={() => void saveGoal()}
      onCancel={() => setFormOpen(false)}
    />
  ) : null;

  // One live region for the whole panel, held at a stable position in both branches' root fragment
  // so React reuses the same node rather than remounting it. Saving or clearing a goal swaps which
  // branch renders, and a live region that mounts with its text already set is generally not
  // announced at all — the region has to outlive the swap for the announcement to land.
  const liveRegion = (
    <p aria-live="polite" role="status" className="sr-only">
      {announcement}
    </p>
  );

  // Empty state: no goal yet. An invitation to act, not a blank screen. The dip alert still belongs
  // here — computeDipAlert's trailing-average branch doesn't need a goal, so a user whose income
  // just fell off a cliff gets told about it whether or not they've set a target.
  if (!goal) {
    return (
      <>
        {liveRegion}
        <div className="flex flex-col gap-4">
          {dip ? <DipAlertCard dip={dip} /> : null}
          {formOpen ? (
            goalForm
          ) : (
            <Card className="mx-auto max-w-md text-center">
              <h2 className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
                Set a monthly income goal
              </h2>
              <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
                Pick the amount you&rsquo;re aiming to earn each month. We&rsquo;ll show how your verified income
                tracks against it, and how long your savings would cover your costs if work slowed down.
              </p>
              <div className="mt-5 flex justify-center">
                <PillButton type="button" variant="primary" size="compact" onClick={openForm}>
                  Set your goal
                </PillButton>
              </div>
            </Card>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {liveRegion}
      <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">Goals</h2>
          <p className="mt-1 text-(length:--type-caption-size) text-ink-muted-80">
            Your monthly income goal, and how far your money would stretch.
          </p>
        </div>
        {!formOpen ? (
          <div className="flex items-center gap-2">
            <PillButton type="button" variant="primary" size="compact" onClick={openForm}>
              Edit goal
            </PillButton>
            {confirmingClear ? (
              <>
                <button
                  type="button"
                  onClick={() => void clearGoal()}
                  disabled={clearing}
                  aria-busy={clearing}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-(length:--type-caption-size) font-semibold text-danger",
                    "transition-colors duration-(--duration-fast) hover:bg-danger-surface",
                    "active:scale-(--press-scale)",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
                    "disabled:pointer-events-none disabled:opacity-70",
                  )}
                >
                  {clearing ? <SpinnerIcon className="h-4 w-4" /> : null}
                  {clearing ? "Clearing…" : "Confirm clear"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingClear(false)}
                  disabled={clearing}
                  className={cn(
                    "rounded-pill px-3 py-1.5 text-(length:--type-caption-size) font-semibold text-ink-muted-80",
                    "transition-colors duration-(--duration-fast) hover:bg-black/[0.04]",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
                    "disabled:pointer-events-none disabled:opacity-70",
                  )}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingClear(true)}
                className={cn(
                  "rounded-pill px-3 py-1.5 text-(length:--type-caption-size) font-semibold text-ink-muted-80",
                  "transition-colors duration-(--duration-fast) hover:bg-black/[0.04]",
                  "active:scale-(--press-scale)",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
                )}
              >
                Clear goal
              </button>
            )}
          </div>
        ) : null}
      </div>

      {clearError ? (
        <p role="alert" className="text-(length:--type-caption-size) text-danger">
          {clearError}
        </p>
      ) : null}

      {goalForm}

      {dip ? <DipAlertCard dip={dip} /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="text-(length:--type-body-size) font-semibold text-ink">This month vs. your goal</h3>
          {progress && hasVerifiedIncome ? (
            <>
              <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
                In {progress.monthLabel} you have {formatUsdSafe(progress.monthIncome)} of verified income toward your{" "}
                {formatUsdExact(progress.target)} goal — about {formatPercent(progress.attainedFraction)} of the way
                there.
              </p>
              <CalcMeter valuePct={progress.meterPct} className="mt-4" />
              <p className="mt-3 text-(length:--type-caption-size) text-ink-muted-80">
                {progress.met
                  ? `Goal met, with ${formatUsdSafe(progress.surplus)} above it.`
                  : `${formatUsdSafe(progress.remaining)} to go.`}
              </p>
            </>
          ) : (
            <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
              Your goal is {formatUsdExact(goal.targetAmount)} a month. Connect an income platform on the Overview tab
              and we&rsquo;ll start showing your progress against it.
            </p>
          )}
        </Card>

        <RunwayCard runway={runway} hasVerifiedIncome={hasVerifiedIncome} onAddDetails={openForm} />
      </div>

      {attainment && attainment.totalCount > 0 && hasVerifiedIncome ? (
        <AttainmentCard months={attainment.months} metCount={attainment.metCount} target={goal.targetAmount} />
      ) : null}

      <p className="text-center text-(length:--type-fine-print-size) text-ink-muted-48">
        These are planning estimates built from your verified income and the figures you entered — not a prediction of
        what you&rsquo;ll earn, a guarantee, or financial advice.
      </p>
      </div>
    </>
  );
}

type GoalFormProps = {
  targetRef: RefObject<HTMLInputElement | null>;
  targetInput: string;
  expensesInput: string;
  cashInput: string;
  onTargetChange: (value: string) => void;
  onExpensesChange: (value: string) => void;
  onCashChange: (value: string) => void;
  targetError: string | null;
  formError: string | null;
  saving: boolean;
  isEdit: boolean;
  prefilledFromExpenses: boolean;
  onSave: () => void;
  onCancel: () => void;
};

function GoalForm({
  targetRef,
  targetInput,
  expensesInput,
  cashInput,
  onTargetChange,
  onExpensesChange,
  onCashChange,
  targetError,
  formError,
  saving,
  isEdit,
  prefilledFromExpenses,
  onSave,
  onCancel,
}: GoalFormProps) {
  return (
    <Card className="mx-auto w-full max-w-xl">
      <h3 className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
        {isEdit ? "Edit your goal" : "Set your goal"}
      </h3>

      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div>
          <CalcField
            id="goal-target"
            inputRef={targetRef}
            label="Monthly income goal"
            value={targetInput}
            onChange={onTargetChange}
            prefix="$"
            min={0}
            step={50}
            hint="What you're aiming to earn in a month."
            errorId={targetError ? "goal-target-error" : undefined}
          />
          {targetError ? (
            <p id="goal-target-error" role="alert" className="mt-1 text-(length:--type-fine-print-size) text-danger">
              {targetError}
            </p>
          ) : null}
        </div>

        <CalcField
          id="goal-expenses"
          label="Monthly expenses (optional)"
          value={expensesInput}
          onChange={onExpensesChange}
          prefix="$"
          min={0}
          step={50}
          hint={
            prefilledFromExpenses
              ? "Prefilled from your logged expenses — change it if your real monthly costs differ."
              : "Roughly what you spend in a month. Leave blank to use your logged expenses."
          }
        />

        <CalcField
          id="goal-cash"
          label="Savings you could fall back on (optional)"
          value={cashInput}
          onChange={onCashChange}
          prefix="$"
          min={0}
          step={100}
          hint="Add this to see how many months your savings would cover."
        />

        {formError ? (
          <p role="alert" className="text-(length:--type-caption-size) text-danger">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <PillButton type="submit" variant="primary" size="compact" disabled={saving} aria-busy={saving}>
            {saving ? <SpinnerIcon className="h-4 w-4" /> : null}
            {saving ? "Saving…" : "Save goal"}
          </PillButton>
          <PillButton type="button" variant="secondary-light" size="compact" onClick={onCancel} disabled={saving}>
            Cancel
          </PillButton>
        </div>
      </form>
    </Card>
  );
}

function RunwayCard({
  runway,
  hasVerifiedIncome,
  onAddDetails,
}: {
  runway: RunwayEstimate;
  hasVerifiedIncome: boolean;
  onAddDetails: () => void;
}) {
  const expensesCaption =
    runway.expensesSource === "override"
      ? "Based on the monthly expenses you entered."
      : "Based on the expenses you've logged on the Expenses tab.";

  return (
    <Card>
      <h3 className="text-(length:--type-body-size) font-semibold text-ink">If work slowed down</h3>

      {runway.monthlyExpenses <= 0 ? (
        <>
          <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
            Tell us roughly what you spend in a month and we&rsquo;ll show how far your income and savings would stretch.
          </p>
          <div className="mt-4">
            <PillButton type="button" variant="secondary-light" size="compact" onClick={onAddDetails}>
              Add your monthly expenses
            </PillButton>
          </div>
        </>
      ) : (
        <>
          {runway.runwayMonths !== null ? (
            <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
              If your income stopped today, the {formatUsdExact(runway.cashOnHand ?? 0)} you set aside would cover about{" "}
              <span className="font-semibold text-ink">{runway.runwayMonths.toFixed(1)} months</span> of the{" "}
              {formatUsdSafe(runway.monthlyExpenses)} you spend each month.
            </p>
          ) : (
            <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
              Add what you have saved and we&rsquo;ll show how many months it would cover at{" "}
              {formatUsdSafe(runway.monthlyExpenses)} a month.
            </p>
          )}

          {hasVerifiedIncome && runway.coverageRatio !== null ? (
            <p className="mt-3 text-(length:--type-caption-size) text-ink-muted-80">
              Right now your average verified income is about{" "}
              <span className="font-semibold text-ink">{runway.coverageRatio.toFixed(1)}×</span> your monthly spending
              ({formatUsdSafe(runway.averageMonthlyIncome)} coming in, {formatUsdSafe(runway.monthlyExpenses)} going
              out). That&rsquo;s a comparison of the two, not months of savings.
            </p>
          ) : null}

          <p className="mt-3 text-(length:--type-fine-print-size) text-ink-muted-48">{expensesCaption}</p>

          {runway.runwayMonths === null ? (
            <div className="mt-4">
              <PillButton type="button" variant="secondary-light" size="compact" onClick={onAddDetails}>
                Add your savings
              </PillButton>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function AttainmentCard({
  months,
  metCount,
  target,
}: {
  months: MonthAttainment[];
  metCount: number;
  target: number;
}) {
  return (
    <Card>
      <h3 className="text-(length:--type-body-size) font-semibold text-ink">Months you hit your goal</h3>
      <p className="mt-1 text-(length:--type-caption-size) text-ink-muted-80">
        {metCount} of {months.length} months reached {formatUsdExact(target)}.
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {months.map((month) => (
          <li key={month.month} className="flex items-center justify-between gap-3">
            <span className="w-12 shrink-0 text-(length:--type-caption-size) text-ink-muted-80">{month.month}</span>
            <CalcMeter valuePct={Math.min(100, month.attainedFraction * 100)} className="flex-1" />
            <span className="w-20 shrink-0 text-right text-(length:--type-caption-size) text-ink">
              {formatUsdSafe(month.amount)}
            </span>
            <span
              className={cn(
                "w-16 shrink-0 rounded-pill px-2 py-0.5 text-center text-(length:--type-fine-print-size) font-semibold",
                month.met ? "bg-verified-surface text-verified" : "bg-pending-surface text-pending",
              )}
            >
              {month.met ? "Met" : "Missed"}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-(length:--type-fine-print-size) text-ink-muted-48">
        Month-by-month figures are an estimated spread of your verified income totals, not a record of what you were
        paid in each month. They&rsquo;ll get more precise as real monthly income data becomes available.
      </p>
    </Card>
  );
}

/**
 * Deliberately not a `Card`: this needs the pending status *pair* (foreground + surface) rather than
 * the card's hairline-on-canvas treatment, and layering those through `className` would leave which
 * border/background wins up to Tailwind's stylesheet order, not JSX order (see the note in
 * components/ui/pill-button.tsx). Status colour is never the sole carrier — the heading says it.
 */
function DipAlertCard({ dip }: { dip: NonNullable<ReturnType<typeof computeDipAlert>> }) {
  return (
    <div className="rounded-lg border border-pending/40 bg-pending-surface p-6">
      <div role="status" className="flex flex-col gap-1">
        <h3 className="text-(length:--type-body-size) font-semibold text-ink">
          Heads up: {dip.monthLabel} is running low
        </h3>
        <p className="text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
          {dip.belowGoal
            ? `${dip.monthLabel} is ${formatUsdSafe(dip.goalShortfall)} short of your goal, at ${formatUsdSafe(dip.monthIncome)}.`
            : null}{" "}
          {dip.belowTrailingAverage
            ? `That's about ${formatPercent(dip.trailingDropFraction)} below your recent average of ${formatUsdSafe(dip.trailingAverage)} a month — more than the ${DIP_THRESHOLD_PCT}% dip we flag.`
            : null}
        </p>
        <p className="text-(length:--type-fine-print-size) text-ink-muted-48">
          This is a nudge based on your verified income so far, not a prediction about the rest of the month.
        </p>
      </div>
    </div>
  );
}
