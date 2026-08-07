import { describe, it, expect } from "vitest";
import {
  contactMessageSchema,
  stripHeaderControlChars,
  HONEYPOT_FIELD,
  MAX_MESSAGE_LENGTH,
  MAX_SUBJECT_LENGTH,
  MIN_MESSAGE_LENGTH,
} from "@/lib/contact";

const valid = {
  name: "Sam Rivera",
  email: "sam@example.com",
  subject: "Uber connection missing",
  message: "My Uber earnings stopped showing up after Tuesday.",
};

describe("contactMessageSchema", () => {
  it("accepts a well-formed message and trims surrounding whitespace", () => {
    const parsed = contactMessageSchema.safeParse({ ...valid, name: "  Sam Rivera  " });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.name).toBe("Sam Rivera");
  });

  it("rejects a malformed email", () => {
    const parsed = contactMessageSchema.safeParse({ ...valid, email: "not-an-email" });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.flatten().fieldErrors.email).toBeDefined();
  });

  it("rejects a message shorter than the minimum, counted after trimming", () => {
    const parsed = contactMessageSchema.safeParse({ ...valid, message: `${" ".repeat(50)}help${" ".repeat(50)}` });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.flatten().fieldErrors.message).toBeDefined();
  });

  it("bounds every long field so a submission can't be used as an unbounded payload", () => {
    const oversized = contactMessageSchema.safeParse({
      ...valid,
      subject: "s".repeat(MAX_SUBJECT_LENGTH + 1),
      message: "m".repeat(MAX_MESSAGE_LENGTH + 1),
    });

    expect(oversized.success).toBe(false);
    const fields = oversized.error?.flatten().fieldErrors;
    expect(fields?.subject).toBeDefined();
    expect(fields?.message).toBeDefined();

    // The boundary values themselves stay valid — the cap is inclusive, not off by one.
    const atLimit = contactMessageSchema.safeParse({
      ...valid,
      subject: "s".repeat(MAX_SUBJECT_LENGTH),
      message: "m".repeat(MAX_MESSAGE_LENGTH),
    });
    expect(atLimit.success).toBe(true);
    expect(MIN_MESSAGE_LENGTH).toBeLessThan(MAX_MESSAGE_LENGTH);
  });

  it("treats the honeypot as optional, so a legitimate client that omits it still validates", () => {
    expect(contactMessageSchema.safeParse(valid).success).toBe(true);

    // A filled honeypot still *parses* — it's the route that decides what a non-empty value means
    // (silently drop), deliberately not a validation error the bot could learn from.
    const filled = contactMessageSchema.safeParse({ ...valid, [HONEYPOT_FIELD]: "Acme Inc" });
    expect(filled.success).toBe(true);
    expect(filled.data?.[HONEYPOT_FIELD]).toBe("Acme Inc");
  });
});

describe("stripHeaderControlChars", () => {
  it("collapses CRLF so a subject can't smuggle a second email header", () => {
    const injected = ["Password reset", "Bcc: victim@example.com"].join("\r\n");

    const result = stripHeaderControlChars(injected);

    expect(result).toBe("Password reset Bcc: victim@example.com");
    expect(result).not.toContain("\r");
    expect(result).not.toContain("\n");
  });

  it("removes other C0/C1 control characters and collapses the resulting whitespace", () => {
    const withControls = `a${String.fromCharCode(0)}b${String.fromCharCode(0x7f)}c${String.fromCharCode(9)}d`;

    expect(stripHeaderControlChars(withControls)).toBe("a b c d");
  });

  it("leaves ordinary text — including non-ASCII — untouched apart from trimming", () => {
    expect(stripHeaderControlChars("  Rapport vérifié — question  ")).toBe("Rapport vérifié — question");
  });
});
