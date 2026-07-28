// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SharingPanel } from "@/components/dashboard/sharing-panel";
import type { ReportShareDto } from "@/lib/report-shares";

// Same manual-cleanup pattern as expenses-panel.test.tsx (globals off in the shared node config,
// no auto-cleanup wired).
afterEach(cleanup);

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

// CopyButton (rendered inside the create-success view below) is only asserted to *render* here —
// clicking it and exercising the actual clipboard write is covered in isolation by
// components/ui/copy-button.test.tsx, which documents why userEvent.setup()'s own clipboard stub
// means a mock installed before that call gets silently clobbered.

const DAY_MS = 24 * 60 * 60 * 1000;

function makeShare(overrides: Partial<ReportShareDto> = {}): ReportShareDto {
  return {
    id: "share-1",
    reportJobId: "report-1",
    expiresAt: new Date(Date.now() + 7 * DAY_MS),
    revokedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    firstViewedAt: null,
    ...overrides,
  };
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

describe("SharingPanel — empty state", () => {
  it("shows 'No share links yet.' when initialShares is empty, with create enabled", () => {
    render(<SharingPanel latestReadyReportJobId="report-1" initialShares={[]} maxActiveShares={10} maxShareExpiryDays={90} />);

    expect(screen.getByText("No share links yet.")).toBeTruthy();
    const createButton = screen.getByRole("button", { name: "Create share link" }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(false);
  });
});

describe("SharingPanel — cap reached", () => {
  it("disables the create button and shows the '10 of 10' message with 10 active shares", () => {
    const shares = Array.from({ length: 10 }, (_, i) => makeShare({ id: `share-${i}` }));
    render(<SharingPanel latestReadyReportJobId="report-1" initialShares={shares} maxActiveShares={10} maxShareExpiryDays={90} />);

    const createButton = screen.getByRole("button", { name: "Create share link" }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
    expect(screen.getByText("10 of 10 active links — revoke one to create another.")).toBeTruthy();
  });
});

describe("SharingPanel — create flow", () => {
  it("creates a link, shows the one-time URL and copy button, announces, and refreshes", async () => {
    const user = userEvent.setup();
    render(<SharingPanel latestReadyReportJobId="report-1" initialShares={[]} maxActiveShares={10} maxShareExpiryDays={90} />);

    await user.click(screen.getByRole("button", { name: "Create share link" }));
    await user.click(screen.getByRole("radio", { name: "24 hours" }));

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { shareId: "share-99", url: "https://veriq.app/verify/rawtoken123" } }, true),
    );

    await user.click(screen.getByRole("button", { name: "Create link" }));

    await waitFor(() => expect(screen.getByLabelText("Share link URL")).toBeTruthy());
    expect((screen.getByLabelText("Share link URL") as HTMLInputElement).value).toBe(
      "https://veriq.app/verify/rawtoken123",
    );
    expect(screen.getByRole("button", { name: "Copy share link" })).toBeTruthy();
    expect(screen.getByText("Share link created")).toBeTruthy();
    expect(refreshMock).toHaveBeenCalled();

    // The request was fired against the create endpoint with the expected payload shape.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/report/shares");
    expect(JSON.parse(init.body as string)).toMatchObject({ reportJobId: "report-1" });
  });

  it("shows the inline cap-reached error banner on a 409 response", async () => {
    const user = userEvent.setup();
    render(<SharingPanel latestReadyReportJobId="report-1" initialShares={[]} maxActiveShares={10} maxShareExpiryDays={90} />);

    await user.click(screen.getByRole("button", { name: "Create share link" }));

    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "SHARE_CAP_REACHED",
            message: "This report already has the maximum of 10 active share links — revoke one before creating another.",
          },
        },
        false,
      ),
    );

    await user.click(screen.getByRole("button", { name: "Create link" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("maximum of 10 active share links");
    // The dialog stays on the form (no one-time URL was ever returned), and nothing was refreshed.
    expect(screen.queryByLabelText("Share link URL")).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("SharingPanel — revoke flow", () => {
  it("revokes on confirm and triggers a router refresh", async () => {
    const user = userEvent.setup();
    render(
      <SharingPanel
        latestReadyReportJobId="report-1"
        initialShares={[makeShare({ id: "share-1" })]}
        maxActiveShares={10}
        maxShareExpiryDays={90}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Revoke" }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();

    fetchMock.mockResolvedValueOnce(jsonResponse({}, true));

    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(screen.getByText("Share link revoked")).toBeTruthy();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/report/shares/share-1");
    expect(init.method).toBe("DELETE");
  });

  it("surfaces an inline row error and does not refresh when the revoke request fails", async () => {
    const user = userEvent.setup();
    render(
      <SharingPanel
        latestReadyReportJobId="report-1"
        initialShares={[makeShare({ id: "share-1" })]}
        maxActiveShares={10}
        maxShareExpiryDays={90}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Revoke" }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "NOT_FOUND", message: "Couldn't revoke this share link." } }, false),
    );

    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
