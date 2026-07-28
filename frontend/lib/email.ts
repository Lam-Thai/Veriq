import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/**
 * Fire-and-forget notification for the "your shared report was viewed for the first time" event
 * (see lib/report-shares.ts's first-view gate, added in a later phase). Never throws — the caller
 * is the public /verify page, which must render the report regardless of whether this email
 * succeeds, fails, or has no configured provider to send through.
 */
export async function sendFirstShareViewEmail(params: { to: string; reportShareId: string }): Promise<void> {
  if (!resend) {
    logger.warn({ reportShareId: params.reportShareId }, "[email] RESEND_API_KEY unset — skipping notification");
    return;
  }
  try {
    await resend.emails.send({
      from: env.RESEND_FROM_EMAIL ?? "Veriq <notifications@veriq.app>",
      to: params.to,
      subject: "Your shared income report was viewed",
      text: "Your shared verified-income report link was just viewed for the first time.",
    });
  } catch (err) {
    logger.error({ err, reportShareId: params.reportShareId }, "[email] first-view send failed");
    // Never throw — caller (the public /verify page) treats this as fire-and-forget and must
    // never fail to render the report just because the notification email failed to send.
  }
}
