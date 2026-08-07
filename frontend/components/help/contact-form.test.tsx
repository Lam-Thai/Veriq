// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContactForm } from "@/components/help/contact-form";
import { HONEYPOT_FIELD } from "@/lib/contact";

// Same manual-cleanup pattern as the dashboard panel tests (globals off in the shared node config,
// no jest-dom matchers wired in — assertions stick to plain Chai + DOM properties).
afterEach(cleanup);

function renderForm(props: Partial<ComponentProps<typeof ContactForm>> = {}) {
  return render(<ContactForm signedIn configured defaultName="Sam Rivera" defaultEmail="sam@example.com" {...props} />);
}

async function fillValidMessage(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Subject"), "Uber connection missing");
  await user.type(screen.getByLabelText("Message"), "My Uber earnings stopped showing up after Tuesday.");
}

describe("ContactForm", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prompts a signed-out visitor to sign in instead of rendering an unusable form", () => {
    renderForm({ signedIn: false });

    expect(screen.getByRole("heading", { name: "Sign in to contact us" })).toBeTruthy();
    expect(screen.queryByLabelText("Message")).toBe(null);
  });

  it("degrades to an explanatory notice when email delivery isn't configured", () => {
    renderForm({ configured: false });

    expect(screen.getByRole("heading", { name: "The contact form is offline" })).toBeTruthy();
    expect(screen.queryByLabelText("Message")).toBe(null);
  });

  it("blocks an invalid submit client-side, marks the field, and moves focus to it", async () => {
    const user = userEvent.setup();
    renderForm({ defaultEmail: "not-an-email" });
    await fillValidMessage(user);

    await user.click(screen.getByRole("button", { name: "Send message" }));

    const email = screen.getByLabelText("Your email");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    // The error is announced and wired to the input, not just painted red.
    expect(email.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    // Focus lands on the offending field rather than being stranded on the submit button.
    expect(document.activeElement).toBe(email);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the message and confirms, moving focus into the confirmation", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { delivered: true } }) });
    renderForm();
    await fillValidMessage(user);

    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Message sent" })).toBeTruthy());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/contact");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.subject).toBe("Uber connection missing");
    // The honeypot rides along empty for a real human — a value here is what flags a bot.
    expect(body[HONEYPOT_FIELD]).toBe("");
    expect(document.activeElement?.textContent).toContain("we’ve got it");
  });

  it("surfaces the server's error message from the { error } envelope without losing what was typed", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: { code: "RATE_LIMITED", message: "Too many requests — try again shortly." } }),
    });
    renderForm();
    await fillValidMessage(user);

    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Too many requests");
    });
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toContain("stopped showing up");
  });

  it("renders server-side field errors from a 422 against the right inputs", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        error: { code: "VALIDATION_FAILED", message: "Validation failed", fields: { subject: ["Subject is too long"] } },
      }),
    });
    renderForm();
    await fillValidMessage(user);

    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Subject").getAttribute("aria-invalid")).toBe("true");
    });
    expect(screen.getByRole("alert").textContent).toContain("Subject is too long");
  });
});
