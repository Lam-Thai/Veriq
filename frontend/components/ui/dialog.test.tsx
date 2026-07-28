// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog } from "@/components/ui/dialog";

// Same manual-cleanup pattern as disclosure.test.tsx (globals off in the shared node config).
afterEach(cleanup);

function Harness({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Add expense" description="A description">
      <button type="button">First</button>
      <button type="button">Last</button>
    </Dialog>
  );
}

// Stateful harness with a real trigger, for exercising focus-restore-on-close.
function ToggleHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add expense">
        <button type="button">Inside</button>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("renders a labelled modal dialog with its title and description", () => {
    render(<Harness onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("heading", { name: "Add expense" })).toBeTruthy();
    // aria-labelledby points at the title heading.
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy && document.getElementById(labelledBy)?.textContent).toBe("Add expense");
  });

  it("moves initial focus to the dialog panel (so its title/role is announced)", () => {
    render(<Harness onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when the close button is activated", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("traps Tab focus within the dialog (wraps last → first)", async () => {
    const user = userEvent.setup();
    render(<Harness onClose={() => {}} />);
    // "Last" is the final focusable in DOM order; Tab from it wraps back to the first control
    // (the close button), never escaping to the document behind the modal.
    screen.getByRole("button", { name: "Last" }).focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close dialog" }));
  });

  it("traps Shift+Tab focus within the dialog (wraps first → last)", async () => {
    const user = userEvent.setup();
    render(<Harness onClose={() => {}} />);
    // The close button is the first focusable in DOM order; Shift+Tab from it wraps to the last.
    screen.getByRole("button", { name: "Close dialog" }).focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last" }));
  });

  it("closes on a backdrop press but not on a press inside the panel", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);

    // A press inside the panel must not close.
    await user.click(screen.getByRole("button", { name: "First" }));
    expect(onClose).not.toHaveBeenCalled();

    // A press on the backdrop (the dialog's parent overlay) closes.
    const backdrop = screen.getByRole("dialog").parentElement!;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("restores focus to the trigger when it closes", async () => {
    const user = userEvent.setup();
    render(<ToggleHarness />);
    const trigger = screen.getByRole("button", { name: "Open" });

    trigger.focus();
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("does not render when closed", () => {
    render(
      <Dialog open={false} onClose={() => {}} title="Hidden">
        <button type="button">Nope</button>
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
