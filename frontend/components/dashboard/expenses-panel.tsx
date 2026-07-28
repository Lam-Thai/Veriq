"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { PillButton } from "@/components/ui/pill-button";
import { CloseIcon, SpinnerIcon } from "@/components/ui/icons";
import { ExpenseSummaryCards } from "@/components/dashboard/expense-summary";
import { ExpenseFormDialog } from "@/components/dashboard/expense-form-dialog";
import { formatUsdExact } from "@/components/dashboard/calc-format";
import { isErrorEnvelope } from "@/lib/error-envelope";
import {
  DEFAULT_PAGE_SIZE,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
  type ExpenseDto,
} from "@/lib/expenses";
import type { ExpenseSummary } from "@/lib/expense-calculators";

type CategoryFilter = ExpenseCategory | "ALL";

type ExpensesPanelProps = {
  initialExpenses: ExpenseDto[];
  initialNextCursor: string | null;
  summary: ExpenseSummary;
};

const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function formatExpenseDate(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso.slice(0, 10) : DATE_FMT.format(new Date(parsed));
}

type ListStatus = "idle" | "loading" | "loadingMore" | "error" | "loadMoreError";

/**
 * "Expenses" tab body — the interactive counterpart to the read-only Calculators tab. Renders the
 * server-computed summary (net income, expense totals, estimated deductions) and a keyset-paginated,
 * category-filterable list with add/edit/soft-delete via the {data}/{error} API. Covers all four
 * state variants: empty (an invitation to log the first expense), loading (skeleton rows / busy
 * buttons), error (with retry), and populated. After any mutation it refetches the current list page
 * and calls router.refresh() so the server-computed summary re-derives from persisted data.
 */
export function ExpensesPanel({ initialExpenses, initialNextCursor, summary }: ExpensesPanelProps) {
  const router = useRouter();

  const [expenses, setExpenses] = useState<ExpenseDto[]>(initialExpenses);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [filter, setFilter] = useState<CategoryFilter>("ALL");
  const [listStatus, setListStatus] = useState<ListStatus>("idle");
  const [listError, setListError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseDto | null>(null);

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const [announcement, setAnnouncement] = useState("");

  // Monotonic guard against out-of-order responses: applyFilter/loadMore/refreshAfterMutation each
  // bump this before fetching and only apply their result if still the latest call — so a slower,
  // earlier request can never clobber a faster, later one (e.g. a stale list resurrecting a row a
  // later delete already removed, or a filter's result landing under the wrong active chip).
  const requestSeqRef = useRef(0);

  async function fetchPage(category: CategoryFilter, cursor?: string): Promise<{ data: ExpenseDto[]; nextCursor: string | null }> {
    const params = new URLSearchParams({ limit: String(DEFAULT_PAGE_SIZE) });
    if (category !== "ALL") params.set("category", category);
    if (cursor) params.set("cursor", cursor);

    const response = await fetch(`/api/expenses?${params.toString()}`);
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(isErrorEnvelope(body) ? body.error.message : "Couldn't load expenses.");
    }
    const envelope = body as { data: ExpenseDto[]; meta?: { nextCursor: string | null } };
    return { data: envelope.data, nextCursor: envelope.meta?.nextCursor ?? null };
  }

  async function applyFilter(next: CategoryFilter) {
    const seq = ++requestSeqRef.current;
    setFilter(next);
    setListStatus("loading");
    setListError(null);
    setPendingDelete(null);
    setRowError({});
    try {
      const { data, nextCursor: cursor } = await fetchPage(next);
      if (seq !== requestSeqRef.current) return;
      setExpenses(data);
      setNextCursor(cursor);
      setListStatus("idle");
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setListError(err instanceof Error ? err.message : "Couldn't load expenses.");
      setListStatus("error");
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    const seq = ++requestSeqRef.current;
    setListStatus("loadingMore");
    setListError(null);
    try {
      const { data, nextCursor: cursor } = await fetchPage(filter, nextCursor);
      if (seq !== requestSeqRef.current) return;
      setExpenses((current) => [...current, ...data]);
      setNextCursor(cursor);
      setListStatus("idle");
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setListError(err instanceof Error ? err.message : "Couldn't load more expenses.");
      setListStatus("loadMoreError");
    }
  }

  // Re-fetch page 1 of the active filter and re-derive the server summary. Called after every
  // successful mutation so the list and the totals both resync from persisted data.
  async function refreshAfterMutation() {
    const seq = ++requestSeqRef.current;
    try {
      const { data, nextCursor: cursor } = await fetchPage(filter);
      if (seq === requestSeqRef.current) {
        setExpenses(data);
        setNextCursor(cursor);
        setListStatus("idle");
      }
    } catch {
      // A failed re-fetch leaves the list as-is; router.refresh() below still updates the summary,
      // and the next interaction will resync the list.
    }
    router.refresh();
  }

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(expense: ExpenseDto) {
    setEditing(expense);
    setDialogOpen(true);
  }

  async function confirmDelete(id: string) {
    setDeletingId(id);
    setRowError((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
    try {
      const response = await fetch(`/api/expenses/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setRowError((current) => ({
          ...current,
          [id]: isErrorEnvelope(body) ? body.error.message : "Couldn't delete this expense.",
        }));
        return;
      }
      setPendingDelete(null);
      setAnnouncement("Expense deleted");
      await refreshAfterMutation();
    } catch {
      setRowError((current) => ({ ...current, [id]: "Couldn't delete this expense." }));
    } finally {
      setDeletingId(null);
    }
  }

  function handleSaved() {
    setAnnouncement(editing ? "Expense updated" : "Expense added");
    void refreshAfterMutation();
  }

  // True empty state: the user has no expenses at all (in the trailing window). An invitation to
  // act, not a blank screen — and not shown merely because a category filter returned nothing. Also
  // gated on the local `expenses` list so a just-added first expense (refreshAfterMutation already
  // fetched it into local state) doesn't get masked by the server `summary` prop, which only catches
  // up once router.refresh() resolves.
  if (!summary.hasExpenses && expenses.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Card className="mx-auto max-w-md text-center">
          <h2 className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
            Track your business expenses
          </h2>
          <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
            Log expenses like mileage, supplies, and platform fees to see your net (after-expense) income and an
            estimated deductible total alongside your verified income.
          </p>
          <div className="mt-5 flex justify-center">
            <PillButton type="button" variant="primary" size="compact" onClick={openAdd}>
              Add your first expense
            </PillButton>
          </div>
        </Card>
        <ExpenseFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} expense={editing} onSaved={handleSaved} />
      </div>
    );
  }

  const showSkeleton = listStatus === "loading";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">Expenses</h2>
          <p className="mt-1 text-(length:--type-caption-size) text-ink-muted-80">
            Net income and estimated deductions from your logged expenses.
          </p>
        </div>
        <PillButton type="button" variant="primary" size="compact" onClick={openAdd}>
          Add expense
        </PillButton>
      </div>

      <ExpenseSummaryCards summary={summary} />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-(length:--type-fine-print-size) text-ink-muted-48">Filter</span>
          <div role="group" aria-label="Filter expenses by category" className="flex flex-wrap gap-1.5">
            <FilterChip label="All" active={filter === "ALL"} onClick={() => void applyFilter("ALL")} />
            {EXPENSE_CATEGORIES.map((category) => (
              <FilterChip
                key={category}
                label={EXPENSE_CATEGORY_LABELS[category]}
                active={filter === category}
                onClick={() => void applyFilter(category)}
              />
            ))}
          </div>
        </div>

        <p aria-live="polite" role="status" className="sr-only">
          {announcement}
        </p>

        {showSkeleton ? (
          <ul className="flex flex-col gap-2" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, index) => (
              <li key={index} className="h-16 animate-pulse rounded-lg border border-hairline bg-black/[0.03]" />
            ))}
          </ul>
        ) : listStatus === "error" ? (
          <Card className="text-center">
            <p className="text-(length:--type-body-size) text-ink-muted-80">{listError}</p>
            <div className="mt-4 flex justify-center">
              <PillButton type="button" variant="secondary-light" size="compact" onClick={() => void applyFilter(filter)}>
                Try again
              </PillButton>
            </div>
          </Card>
        ) : expenses.length === 0 ? (
          <Card className="text-center">
            <p className="text-(length:--type-body-size) text-ink-muted-80">
              No expenses in this category yet.
            </p>
          </Card>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {expenses.map((expense) => (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  isPendingDelete={pendingDelete === expense.id}
                  isDeleting={deletingId === expense.id}
                  error={rowError[expense.id]}
                  onEdit={() => openEdit(expense)}
                  onRequestDelete={() => setPendingDelete(expense.id)}
                  onCancelDelete={() => setPendingDelete(null)}
                  onConfirmDelete={() => void confirmDelete(expense.id)}
                />
              ))}
            </ul>
            {listStatus === "loadMoreError" && listError ? (
              <p role="alert" className="text-center text-(length:--type-caption-size) text-danger">
                {listError}
              </p>
            ) : null}
            {nextCursor ? (
              <div className="flex justify-center">
                <PillButton
                  type="button"
                  variant="secondary-light"
                  size="compact"
                  onClick={() => void loadMore()}
                  disabled={listStatus === "loadingMore"}
                  aria-busy={listStatus === "loadingMore"}
                >
                  {listStatus === "loadingMore" ? "Loading…" : listStatus === "loadMoreError" ? "Try again" : "Load more"}
                </PillButton>
              </div>
            ) : null}
          </>
        )}
      </div>

      <ExpenseFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} expense={editing} onSaved={handleSaved} />
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-pill px-3 py-1.5 text-(length:--type-fine-print-size) font-semibold",
        "transition-colors duration-(--duration-fast)",
        "active:scale-(--press-scale)",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
        active ? "bg-primary text-on-primary" : "bg-transparent text-ink-muted-80 hover:bg-black/[0.04]",
      )}
    >
      {label}
    </button>
  );
}

type ExpenseRowProps = {
  expense: ExpenseDto;
  isPendingDelete: boolean;
  isDeleting: boolean;
  error?: string | undefined;
  onEdit: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
};

function ExpenseRow({
  expense,
  isPendingDelete,
  isDeleting,
  error,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: ExpenseRowProps) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-hairline bg-canvas p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-(length:--type-body-size) font-semibold text-ink">
              {EXPENSE_CATEGORY_LABELS[expense.category]}
            </p>
            {expense.deductible ? (
              <span className="rounded-pill bg-verified-surface px-2 py-0.5 text-(length:--type-fine-print-size) font-semibold text-verified">
                Deductible
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-(length:--type-fine-print-size) text-ink-muted-48">
            {formatExpenseDate(expense.date)}
            {expense.note ? ` · ${expense.note}` : ""}
          </p>
        </div>

        <p className="shrink-0 text-(length:--type-body-size) font-semibold text-ink">{formatUsdExact(expense.amount)}</p>

        {isPendingDelete ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onConfirmDelete}
              disabled={isDeleting}
              aria-busy={isDeleting}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-(length:--type-caption-size) font-semibold text-danger",
                "transition-colors duration-(--duration-fast) hover:bg-danger-surface",
                "active:scale-(--press-scale)",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
                "disabled:pointer-events-none disabled:opacity-70",
              )}
            >
              {isDeleting ? <SpinnerIcon className="h-4 w-4" /> : null}
              {isDeleting ? "Deleting…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              disabled={isDeleting}
              className={cn(
                "rounded-pill px-3 py-1.5 text-(length:--type-caption-size) font-semibold text-ink-muted-80",
                "transition-colors duration-(--duration-fast) hover:bg-black/[0.04]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
                "disabled:pointer-events-none disabled:opacity-70",
              )}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onEdit}
              className={cn(
                "rounded-pill px-3 py-1.5 text-(length:--type-caption-size) font-semibold text-primary",
                "transition-colors duration-(--duration-fast) hover:bg-primary/10",
                "active:scale-(--press-scale)",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
              )}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onRequestDelete}
              aria-label={`Delete ${EXPENSE_CATEGORY_LABELS[expense.category]} expense of ${formatUsdExact(expense.amount)}`}
              className={cn(
                "rounded-full p-1.5 text-ink-muted-48",
                "transition-colors duration-(--duration-fast) hover:bg-danger-surface hover:text-danger",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
              )}
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-(length:--type-fine-print-size) text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}
