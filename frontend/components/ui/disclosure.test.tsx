// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Disclosure } from "@/components/ui/disclosure";

// The vitest config runs in the `node` environment globally (it only unit-tests the pure lib
// layer), so this DOM-dependent spec opts into jsdom via the per-file docblock above rather than
// changing the shared config. Auto-cleanup isn't wired (globals are off), so we clean up manually.
afterEach(cleanup);

const PANEL_TEXT = "Here is how the number was produced.";

function renderDisclosure() {
  render(<Disclosure>{PANEL_TEXT}</Disclosure>);
  const trigger = screen.getByRole("button", { name: "How we calculated this" });
  // The panel stays mounted (toggled via the `hidden` attribute), so resolve it by the id the
  // trigger's aria-controls points at rather than by role/visibility.
  const panelId = trigger.getAttribute("aria-controls");
  expect(panelId).toBeTruthy();
  const panel = document.getElementById(panelId!);
  expect(panel).not.toBeNull();
  return { trigger, panel: panel! };
}

describe("Disclosure", () => {
  it("renders collapsed by default with the panel hidden", () => {
    const { trigger, panel } = renderDisclosure();

    expect(trigger).toHaveProperty("tagName", "BUTTON");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // Collapsed: the panel is present for a stable aria-controls target but removed from layout and
    // the accessibility tree by the native `hidden` attribute.
    expect(panel.hidden).toBe(true);
  });

  it("keeps aria-controls pointing at the panel's id in both states", async () => {
    const user = userEvent.setup();
    const { trigger, panel } = renderDisclosure();

    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
    await user.click(trigger);
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
  });

  it("expands and collapses on click, flipping aria-expanded and panel visibility", async () => {
    const user = userEvent.setup();
    const { trigger, panel } = renderDisclosure();

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain(PANEL_TEXT);

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
  });

  it("is operable via the keyboard (Enter and Space toggle it)", async () => {
    const user = userEvent.setup();
    const { trigger, panel } = renderDisclosure();

    // Tab moves focus to the native button, so it's in the keyboard tab order.
    await user.tab();
    expect(document.activeElement).toBe(trigger);

    await user.keyboard("{Enter}");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);

    await user.keyboard(" ");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
  });
});
