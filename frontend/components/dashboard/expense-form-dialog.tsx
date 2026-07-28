"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { Dialog } from "@/components/ui/dialog";
import { PillButton } from "@/components/ui/pill-button";
import { CalcField } from "@/components/dashboard/calc-field";
import { isErrorEnvelope } from "@/lib/error-envelope";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  MAX_EXPENSE_AMOUNT,
  MAX_NOTE_LENGTH,
  type ExpenseCategory,
  type ExpenseDto,
} from "@/lib/expenses";

type ExpenseFormDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Present ⇒ edit mode (PATCH); absent/null ⇒ create mode (POST). */
  expense?: ExpenseDto | null;
  /** Called after a successful save so the parent can refresh its list + summary. */
  onSaved: () => void;
};

type FieldErrors = Partial<Record<"amount" | "category" | "date" | "note" | "deductible", string[]>>;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Field ids in DOM order — used to move focus to the first field with a validation error so a
// keyboard/screen-reader user isn't left on the submit button with no idea what failed.
const FIELD_ORDER: Array<{ key: keyof FieldErrors; id: string }> = [
  { key: "amount", id: "expense-amount" },
  { key: "category", id: "expense-category" },
  { key: "date", id: "expense-date" },
  { key: "note", id: "expense-note" },
];

function focusFirstError(errors: FieldErrors): void {
  const first = FIELD_ORDER.find(({ key }) => errors[key]?.length);
  if (first) document.getElementById(first.id)?.focus();
}

/**
 * Create/edit dialog for a single expense. The Dialog unmounts its children when closed, so the
 * inner form below remounts fresh on every open — its field state is initialized straight from the
 * `expense` prop with no reseed effect. `key` (in the parent) also forces a remount if the edited
 * expense changes while the dialog is open.
 */
export function ExpenseFormDialog({ open, onClose, expense, onSaved }: ExpenseFormDialogProps) {
  const isEdit = Boolean(expense);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit expense" : "Add expense"}
      description="Track a business expense to see your net income and estimated deductions."
    >
      <ExpenseForm key={expense?.id ?? "new"} expense={expense ?? null} onClose={onClose} onSaved={onSaved} />
    </Dialog>
  );
}

type ExpenseFormProps = {
  expense: ExpenseDto | null;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * The form body. Holds its fields as raw strings (so a field can be cleared mid-edit), POSTs or
 * PATCHes the {data}/{error} API, and surfaces server-side zod field errors inline (the server is
 * the source of truth for validation — this only does the lightest client guard to avoid an
 * obviously-doomed request). On success it calls `onSaved` then `onClose`.
 */
function ExpenseForm({ expense, onClose, onSaved }: ExpenseFormProps) {
  const isEdit = Boolean(expense);
  const errorId = useId();

  const [amount, setAmount] = useState(() => (expense ? String(expense.amount) : ""));
  const [category, setCategory] = useState<ExpenseCategory>(() => expense?.category ?? "SUPPLIES");
  const [date, setDate] = useState(() => (expense ? expense.date.slice(0, 10) : todayIso()));
  const [note, setNote] = useState(() => expense?.note ?? "");
  const [deductible, setDeductible] = useState(() => expense?.deductible ?? true);

  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setGeneralError(null);

    const parsedAmount = Number.parseFloat(amount);
    const nextErrors: FieldErrors = {};
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      nextErrors.amount = ["Enter an amount greater than 0"];
    } else if (parsedAmount > MAX_EXPENSE_AMOUNT) {
      nextErrors.amount = ["Amount is too large"];
    }
    if (!date) nextErrors.date = ["Choose a date"];
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      focusFirstError(nextErrors);
      return;
    }

    const payload = {
      amount: parsedAmount,
      category,
      date,
      note: note.trim() === "" ? null : note.trim(),
      deductible,
    };

    setSubmitting(true);
    try {
      const response = await fetch(isEdit ? `/api/expenses/${expense!.id}` : "/api/expenses", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        if (
          response.status === 422 &&
          body &&
          typeof body === "object" &&
          "error" in body &&
          body.error &&
          typeof body.error === "object" &&
          "fields" in body.error
        ) {
          const fields = (body.error as { fields: FieldErrors }).fields ?? {};
          setFieldErrors(fields);
          focusFirstError(fields);
          return;
        }
        setGeneralError(isErrorEnvelope(body) ? body.error.message : "Couldn't save this expense.");
        return;
      }

      onSaved();
      onClose();
    } catch {
      setGeneralError("Couldn't save this expense. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <CalcField
          id="expense-amount"
          label="Amount"
          value={amount}
          onChange={setAmount}
          prefix="$"
          min={0}
          step={0.01}
          errorId={fieldErrors.amount ? "expense-amount-error" : undefined}
        />
        <FieldError id="expense-amount-error" errors={fieldErrors.amount} />
      </div>

      <div>
        <label htmlFor="expense-category" className="block text-(length:--type-fine-print-size) text-ink-muted-48">
          Category
        </label>
        <div className={fieldWrapperClass}>
          <select
            id="expense-category"
            value={category}
            onChange={(event) => setCategory(event.target.value as ExpenseCategory)}
            aria-invalid={fieldErrors.category ? true : undefined}
            aria-describedby={fieldErrors.category ? "expense-category-error" : undefined}
            className="w-full bg-transparent text-(length:--type-body-size) font-semibold text-ink outline-none"
          >
            {EXPENSE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {EXPENSE_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <FieldError id="expense-category-error" errors={fieldErrors.category} />
      </div>

      <div>
        <label htmlFor="expense-date" className="block text-(length:--type-fine-print-size) text-ink-muted-48">
          Date
        </label>
        <div className={fieldWrapperClass}>
          <input
            id="expense-date"
            type="date"
            value={date}
            max={todayIso()}
            onChange={(event) => setDate(event.target.value)}
            aria-invalid={fieldErrors.date ? true : undefined}
            aria-describedby={fieldErrors.date ? "expense-date-error" : undefined}
            className="w-full bg-transparent text-(length:--type-body-size) font-semibold text-ink outline-none"
          />
        </div>
        <FieldError id="expense-date-error" errors={fieldErrors.date} />
      </div>

      <div>
        <label htmlFor="expense-note" className="block text-(length:--type-fine-print-size) text-ink-muted-48">
          Note <span className="text-ink-muted-48">(optional)</span>
        </label>
        <div className={fieldWrapperClass}>
          <input
            id="expense-note"
            type="text"
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. Gas for deliveries"
            aria-invalid={fieldErrors.note ? true : undefined}
            aria-describedby={fieldErrors.note ? "expense-note-error" : undefined}
            className="w-full bg-transparent text-(length:--type-body-size) text-ink outline-none placeholder:text-ink-muted-48"
          />
        </div>
        <FieldError id="expense-note-error" errors={fieldErrors.note} />
      </div>

      <label className="flex items-center gap-2 text-(length:--type-caption-size) text-ink">
        <input
          type="checkbox"
          checked={deductible}
          onChange={(event) => setDeductible(event.target.checked)}
          className={cn(
            "h-4 w-4 rounded-xs accent-primary",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
          )}
        />
        Tax-deductible
      </label>

      {generalError ? (
        <p id={errorId} role="alert" className="text-(length:--type-fine-print-size) text-danger">
          {generalError}
        </p>
      ) : null}

      <div className="mt-1 flex items-center justify-end gap-2">
        <PillButton type="button" variant="secondary-light" size="compact" onClick={onClose} disabled={submitting}>
          Cancel
        </PillButton>
        <PillButton type="submit" variant="primary" size="compact" disabled={submitting} aria-busy={submitting}>
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Add expense"}
        </PillButton>
      </div>
    </form>
  );
}

const fieldWrapperClass = cn(
  "mt-1 flex items-center gap-2 rounded-lg border border-hairline bg-canvas px-3 py-2",
  "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-focus",
);

function FieldError({ id, errors }: { id: string; errors: string[] | undefined }) {
  if (!errors || errors.length === 0) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-(length:--type-fine-print-size) text-danger">
      {errors[0]}
    </p>
  );
}
