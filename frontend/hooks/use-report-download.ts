"use client";

import { useCallback, useRef, useState } from "react";

export type ReportDownloadStatus = "idle" | "generating" | "error";

type ErrorEnvelope = { error: { code: string; message: string } };
type CreateJobBody = { data: { jobId: string } };

// Report rendering is fast in practice (a text/table PDF, no images — see lib/report-jobs.tsx),
// but this bounds how long the UI will keep polling a stuck job before giving up with a clear
// message instead of spinning forever.
const POLL_INTERVAL_MS = 1000;
const MAX_POLLS = 120;

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return typeof value === "object" && value !== null && "error" in value;
}

function retryAfterMessage(response: Response): string {
  const retryAfter = response.headers.get("Retry-After");
  return retryAfter ? `Too many requests — try again in ${retryAfter}s.` : "Too many requests — try again shortly.";
}

function filenameFromContentDisposition(headerValue: string | null): string {
  const match = headerValue?.match(/filename="([^"]+)"/);
  return match?.[1] ?? "veriq-verified-income-report.pdf";
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drives the async report-generation flow — `POST /api/report` (creates a job), poll
 * `GET /api/report/[jobId]` until it's ready, then trigger a blob download — behind a single
 * `download()` call. Both report-panel.tsx and report-builder.tsx use this so the polling logic
 * isn't duplicated between them. See app/api/report/route.tsx for why this is async at all: the
 * actual PDF render runs in a Next.js `after()` callback, not on the request that creates the
 * job, so the create call always returns quickly regardless of render time.
 */
export function useReportDownload() {
  const [status, setStatus] = useState<ReportDownloadStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  const download = useCallback(async (platformsParam?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus("generating");
    setErrorMessage(null);

    try {
      const createUrl = platformsParam
        ? `/api/report?${new URLSearchParams({ platforms: platformsParam }).toString()}`
        : "/api/report";
      const createResponse = await fetch(createUrl, { method: "POST" });

      if (createResponse.status === 429) throw new Error(retryAfterMessage(createResponse));
      if (!createResponse.ok) {
        const body: unknown = await createResponse.json().catch(() => null);
        throw new Error(isErrorEnvelope(body) ? body.error.message : "Couldn't start report generation.");
      }

      const created = (await createResponse.json()) as CreateJobBody;
      const { jobId } = created.data;

      for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
        await sleep(POLL_INTERVAL_MS);
        const pollResponse = await fetch(`/api/report/${jobId}`);

        if (pollResponse.status === 429) {
          // The poll rate limit is sized to comfortably cover a full MAX_POLLS run (see
          // app/api/report/[jobId]/route.ts), so this should only ever be a rare edge case (e.g.
          // two tabs polling the same job) — back off for the server's own Retry-After window and
          // keep polling within this same bounded loop, rather than failing the whole download.
          const retryAfterSeconds = Number(pollResponse.headers.get("Retry-After"));
          const waitMs =
            Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
              ? retryAfterSeconds * 1000
              : POLL_INTERVAL_MS;
          await sleep(waitMs);
          continue;
        }

        if (pollResponse.headers.get("Content-Type")?.includes("application/pdf")) {
          const blob = await pollResponse.blob();
          triggerBlobDownload(blob, filenameFromContentDisposition(pollResponse.headers.get("Content-Disposition")));
          setStatus("idle");
          return;
        }

        if (!pollResponse.ok) {
          const body: unknown = await pollResponse.json().catch(() => null);
          throw new Error(isErrorEnvelope(body) ? body.error.message : "Report generation failed.");
        }
        // Still PENDING/PROCESSING (202 with a status body) — loop and poll again.
      }

      throw new Error("Report is taking longer than expected — try again shortly.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }, []);

  return { status, errorMessage, download };
}
