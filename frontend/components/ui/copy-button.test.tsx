// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopyButton } from "@/components/ui/copy-button";

// Same manual-cleanup pattern as dialog.test.tsx/disclosure.test.tsx (globals off in the shared
// node config, auto-cleanup isn't wired).
afterEach(cleanup);

// jsdom doesn't implement the Clipboard API on its own, but @testing-library/user-event's own
// `setup()` installs its *own* in-memory navigator.clipboard stub as a side effect — one that
// silently resolves writeText regardless of what's asked of it. That stub is installed the moment
// `userEvent.setup()` runs, so defining our mock *before* that call gets clobbered (confirmed by
// instrumenting both writes: userEvent.setup() replaces navigator.clipboard's value). The fix is
// ordering: call userEvent.setup() first, then install this mock on top of it, so the assertions
// below observe our mock (and its configured resolve/reject behavior) rather than userEvent's.
function setupClipboard() {
  const user = userEvent.setup();
  const writeTextMock = vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: writeTextMock },
    configurable: true,
  });
  return { user, writeTextMock };
}

describe("CopyButton", () => {
  it("copies the given value and shows the transient 'Copied' confirmation", async () => {
    const { user, writeTextMock } = setupClipboard();
    writeTextMock.mockResolvedValueOnce(undefined);

    render(<CopyButton value="https://veriq.app/verify/abc123" />);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Copy" }).textContent).toContain("Copied"));
    expect(writeTextMock).toHaveBeenCalledWith("https://veriq.app/verify/abc123");
    expect(screen.getByText("Copied to clipboard")).toBeTruthy();
  });

  it("shows an error state, not the copied state, when the clipboard write fails", async () => {
    const { user, writeTextMock } = setupClipboard();
    writeTextMock.mockRejectedValueOnce(new Error("denied"));

    render(<CopyButton value="https://veriq.app/verify/abc123" />);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Copy" }).textContent).toContain("Couldn't copy"));
    expect(screen.getByText("Couldn't copy to clipboard")).toBeTruthy();
  });

  it("uses ariaLabel as the accessible name when provided, distinct from the visible label", async () => {
    const { user, writeTextMock } = setupClipboard();
    writeTextMock.mockResolvedValueOnce(undefined);

    render(<CopyButton value="https://veriq.app/verify/abc123" label="Copy link" ariaLabel="Copy share link" />);

    const button = screen.getByRole("button", { name: "Copy share link" });
    expect(button.textContent).toContain("Copy link");

    await user.click(button);
    await waitFor(() => expect(button.textContent).toContain("Copied"));
    expect(writeTextMock).toHaveBeenCalledWith("https://veriq.app/verify/abc123");
  });
});
