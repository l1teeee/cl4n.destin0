import { log } from "@/infrastructure/observability/logger";

const FORWARD_TIMEOUT_MS = 5_000;

export async function forwardInstagramWebhook(
  url: string,
  rawBody: Buffer,
  headers: { signature: string; contentType: string | null },
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": headers.contentType ?? "application/json",
        "x-hub-signature-256": headers.signature,
      },
      body: new Uint8Array(rawBody),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
    await response.body?.cancel();
    log("info", "instagram_webhook_forwarded", { status: response.status });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    log("warn", "instagram_webhook_forward_failed", { reason: timedOut ? "TIMEOUT" : "NETWORK" });
  }
}
