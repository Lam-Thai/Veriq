// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoalsPanel } from "@/components/dashboard/goals-panel";
import type { IncomeGoalDto } from "@/lib/goals";

// Same manual-cleanup pattern as expenses-panel.test.tsx (globals off in the shared node config, and
// no jest-dom matchers wired in — assertions here stick to plain Chai + DOM properties).
afterEach(cleanup);

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function makeGoal(overrides: Partial<IncomeGoalDto> = {}): IncomeGoalDto {
  return {
    id: "goal-1",
    type: "MONTHLY_TARGET",
    targetAmount: 4000,
    monthlyExpenses: null,
    cashOnHand: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

// A rising curve, matching how lib/income-math.ts distributes verified totals today.
const BREAKDOWN = [
  { month: "Apr", amount: 3000 },
  { month: "May", amount: 3500 },
  { month: "Jun", amount: 4200 },
];

function renderPanel(props: Partial<React.ComponentProps<typeof GoalsPanel>> = {}) {
  return render(
    <GoalsPanel
      goal={null}
      monthlyBreakdown={BREAKDOWN}
      averageMonthly={3566.67}
      hasVerifiedIncome
      loggedMonthlyExpenses={0}
      {...props}
    />,
  );
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  refreshMock.mockClear();
});

describe("GoalsPanel — empty state", () => {
  it("invites the user to set a first goal and saves it through the API", async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.getByRole("heading", { name: "Set a monthly income goal" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Set your goal" }));
    await user.type(screen.getByLabelText("Monthly income goal"), "4000");

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: makeGoal() }));
    await user.click(screen.getByRole("button", { name: "Save goal" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Goals" })).toBeTruthy());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/goals");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      type: "MONTHLY_TARGET",
      targetAmount: 4000,
      monthlyExpenses: null,
      cashOnHand: null,
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("blocks a $0 goal client-side, moves focus to the field, and never calls the API", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Set your goal" }));
    await user.click(screen.getByRole("button", { name: "Save goal" }));

    const field = screen.getByLabelText("Monthly income goal");
    expect(screen.getByRole("alert").textContent).toContain("greater than $0");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GoalsPanel — progress and runway", () => {
  it("shows current-month progress against the goal", () => {
    renderPanel({ goal: makeGoal({ targetAmount: 4000 }) });

    // Jun's $4,200 beats the $4,000 goal.
    expect(document.body.textContent).toContain("In Jun you have $4,200 of verified income toward your $4,000.00 goal");
    expect(document.body.textContent).toContain("Goal met, with $200 above it.");
  });

  it("reports months of runway only once a cash buffer is known", () => {
    const { unmount } = renderPanel({ goal: makeGoal({ monthlyExpenses: 2000, cashOnHand: null }) });

    // No savings figure yet: the coverage multiple is shown and explicitly not called runway.
    expect(document.body.textContent).toContain("Add what you have saved");
    expect(document.body.textContent).toContain("not months of savings");
    expect(document.body.textContent).not.toContain("months of the");
    unmount();

    renderPanel({ goal: makeGoal({ monthlyExpenses: 2000, cashOnHand: 6000 }) });
    expect(document.body.textContent).toContain("3.0 months");
  });

  it("prefills the expenses field from logged expenses when the user has no override", async () => {
    const user = userEvent.setup();
    renderPanel({ goal: makeGoal(), loggedMonthlyExpenses: 1250 });

    await user.click(screen.getByRole("button", { name: "Edit goal" }));

    const field = screen.getByLabelText("Monthly expenses (optional)") as HTMLInputElement;
    expect(field.value).toBe("1250");
    expect(document.body.textContent).toContain("Prefilled from your logged expenses");
  });
});

describe("GoalsPanel — attainment and dip alert", () => {
  it("labels each month met or missed rather than relying on color alone", () => {
    renderPanel({ goal: makeGoal({ targetAmount: 4000 }) });

    expect(document.body.textContent).toContain("1 of 3 months reached $4,000.00");
    expect(screen.getAllByText("Missed").length).toBe(2);
    expect(screen.getAllByText("Met").length).toBe(1);
  });

  it("raises a dip alert when the latest month falls below the goal", () => {
    renderPanel({ goal: makeGoal({ targetAmount: 5000 }) });

    // The panel also carries an sr-only live region for save/clear announcements, so pick the
    // status region that actually holds the dip copy.
    const dip = screen.getAllByRole("status").find((node) => node.textContent?.includes("running low"));
    expect(dip?.textContent).toContain("Jun is $800 short of your goal");
  });

  it("still warns about a steep drop when no goal has been set", () => {
    // computeDipAlert's trailing-average branch doesn't need a goal, so the empty state has to be
    // able to render the alert too — it isn't reachable only from the populated branch.
    renderPanel({
      goal: null,
      monthlyBreakdown: [
        { month: "Apr", amount: 4000 },
        { month: "May", amount: 4000 },
        { month: "Jun", amount: 2000 },
      ],
    });

    expect(screen.getByRole("heading", { name: "Set a monthly income goal" })).toBeTruthy();
    const dip = screen.getAllByRole("status").find((node) => node.textContent?.includes("running low"));
    expect(dip?.textContent).toContain("50% below your recent average");
  });

  it("stays silent when the latest month clears the goal", () => {
    renderPanel({ goal: makeGoal({ targetAmount: 4000 }) });

    expect(document.body.textContent).not.toContain("running low");
  });
});

describe("GoalsPanel — clearing", () => {
  it("requires confirmation, then returns to the empty state", async () => {
    const user = userEvent.setup();
    renderPanel({ goal: makeGoal() });

    await user.click(screen.getByRole("button", { name: "Clear goal" }));
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: "goal-1" } }));
    await user.click(screen.getByRole("button", { name: "Confirm clear" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Set a monthly income goal" })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/goals/goal-1", { method: "DELETE" });
  });

  it("surfaces a server error without dropping the goal from the view", async () => {
    const user = userEvent.setup();
    renderPanel({ goal: makeGoal() });

    await user.click(screen.getByRole("button", { name: "Clear goal" }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "RATE_LIMITED", message: "Too many requests — try again shortly." } }, false),
    );
    await user.click(screen.getByRole("button", { name: "Confirm clear" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Too many requests"));
    expect(screen.queryByRole("heading", { name: "Goals" })).toBeTruthy();
  });
});
