// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExpensesPanel } from "@/components/dashboard/expenses-panel";
import type { ExpenseDto } from "@/lib/expenses";
import type { ExpenseSummary } from "@/lib/expense-calculators";

// Same manual-cleanup pattern as dialog.test.tsx (globals off in the shared node config, and no
// jest-dom matchers wired in — assertions here stick to plain Chai + DOM properties).
afterEach(cleanup);

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

// The real dialog owns its own validation/submit flow (covered elsewhere); here we only need a
// trigger that fires onSaved so the panel's post-mutation refetch logic can be exercised.
vi.mock("@/components/dashboard/expense-form-dialog", () => ({
  ExpenseFormDialog: ({ open, onSaved }: { open: boolean; onSaved: () => void }) =>
    open ? (
      <button type="button" onClick={onSaved}>
        Save expense
      </button>
    ) : null,
}));

function makeExpense(overrides: Partial<ExpenseDto> = {}): ExpenseDto {
  return {
    id: "exp-1",
    amount: 42,
    category: "SUPPLIES",
    date: "2026-07-01T00:00:00.000Z",
    note: null,
    deductible: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSummary(overrides: Partial<ExpenseSummary> = {}): ExpenseSummary {
  return {
    hasExpenses: true,
    count: 1,
    thisMonthTotal: 42,
    byMonth: [],
    windowTotal: 42,
    deductibleTotal: 42,
    averageMonthlyGross: 1000,
    annualizedGross: 12000,
    netMonthly: 958,
    netAnnualized: 11958,
    taxRatePct: 15,
    estimatedTaxSavings: 6.3,
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function categoryOf(url: string): string | null {
  return new URL(url, "http://localhost").searchParams.get("category");
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  refreshMock.mockClear();
});

describe("ExpensesPanel — applyFilter", () => {
  it("ignores a stale (out-of-order) response when a later filter click already landed", async () => {
    const user = userEvent.setup();
    const vehicle = deferred<Response>();

    fetchMock.mockImplementation((input: string) => {
      const category = categoryOf(input);
      if (category === "VEHICLE_MILEAGE") return vehicle.promise;
      if (category === "SUPPLIES") {
        return Promise.resolve(
          jsonResponse({
            data: [makeExpense({ id: "supplies-1", category: "SUPPLIES", note: "Supplies receipt" })],
            meta: { nextCursor: null },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: [], meta: { nextCursor: null } }));
    });

    render(
      <ExpensesPanel
        initialExpenses={[makeExpense({ note: "Original item" })]}
        initialNextCursor={null}
        summary={makeSummary()}
      />,
    );

    // Fire the vehicle-mileage filter first (its response is held back)...
    await user.click(screen.getByRole("button", { name: "Vehicle & mileage" }));
    // ...then the supplies filter, whose response resolves immediately.
    await user.click(screen.getByRole("button", { name: "Supplies" }));

    await waitFor(() => expect(screen.queryByText(/Supplies receipt/)).toBeTruthy());

    // The earlier vehicle-mileage request finally resolves — since a later request already landed,
    // its data must be discarded rather than clobbering the current (supplies) view.
    vehicle.resolve(
      jsonResponse({
        data: [makeExpense({ id: "vehicle-1", category: "VEHICLE_MILEAGE", note: "Vehicle receipt" })],
        meta: { nextCursor: null },
      }),
    );

    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(/Supplies receipt/)).toBeTruthy();
    expect(screen.queryByText(/Vehicle receipt/)).toBeNull();
    expect(screen.getByRole("button", { name: "Supplies" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("ExpensesPanel — loadMore", () => {
  it("surfaces an inline error without clearing the loaded list, and supports retry", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new Error("boom"));

    render(
      <ExpensesPanel
        initialExpenses={[makeExpense({ note: "Original item" })]}
        initialNextCursor="cursor-1"
        summary={makeSummary()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("boom"));
    // The already-loaded row must still be there — a pagination failure doesn't wipe the list.
    expect(screen.queryByText(/Original item/)).toBeTruthy();

    const retryButton = screen.getByRole("button", { name: "Try again" });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [makeExpense({ id: "exp-2", note: "Loaded via retry" })],
        meta: { nextCursor: null },
      }),
    );

    await user.click(retryButton);

    await waitFor(() => expect(screen.queryByText(/Loaded via retry/)).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    // No further cursor was returned, so the load-more control drops away.
    expect(screen.queryByRole("button", { name: /load more|try again/i })).toBeNull();
  });
});

describe("ExpensesPanel — refreshAfterMutation empty-state behavior", () => {
  it("replaces the empty-state CTA with the fetched list before router.refresh() resolves the summary", async () => {
    const user = userEvent.setup();

    render(<ExpensesPanel initialExpenses={[]} initialNextCursor={null} summary={makeSummary({ hasExpenses: false, count: 0 })} />);

    expect(screen.getByRole("heading", { name: "Track your business expenses" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add your first expense" }));

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [makeExpense({ id: "first-expense", note: "First logged expense" })],
        meta: { nextCursor: null },
      }),
    );

    await user.click(screen.getByRole("button", { name: "Save expense" }));

    // The panel's own refetch already has the new expense, so the CTA must disappear even though the
    // `summary` prop (still hasExpenses: false, only updated once router.refresh() re-renders) hasn't
    // caught up yet.
    await waitFor(() => expect(screen.queryByText(/First logged expense/)).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "Track your business expenses" })).toBeNull();
    expect(refreshMock).toHaveBeenCalled();
  });
});
