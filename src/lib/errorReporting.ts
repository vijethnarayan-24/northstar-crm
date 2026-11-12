import { apiUrl } from "./api";

/**
 * Sends browser errors to the API (POST /api/v1/client-errors), where they are stored with
 * server errors and shown to admins on Settings → System status. Deliberately lightweight:
 * never throws, never retries, and at most 10 reports per page load so a crash loop can't
 * flood the server.
 */
let sent = 0;
const seen = new Set<string>();

export function reportClientError(error: unknown, extra: { componentStack?: string; source?: string } = {}) {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const key = `${err.message}|${location.pathname}`;
    if (sent >= 10 || seen.has(key)) return;
    seen.add(key);
    sent++;
    const body = JSON.stringify({
      message: err.message.slice(0, 500),
      stack: [err.stack, extra.componentStack].filter(Boolean).join("\n--- component stack ---\n").slice(0, 4000) || undefined,
      path: location.pathname,
      source: extra.source ?? "react",
    });
    void fetch(apiUrl("/client-errors"), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    /* reporting must never break the app */
  }
}

/** Uncaught errors and promise rejections anywhere on the page. */
export function installGlobalErrorReporting() {
  window.addEventListener("error", (e) => reportClientError(e.error ?? e.message, { source: "window" }));
  window.addEventListener("unhandledrejection", (e) => reportClientError(e.reason, { source: "promise" }));
}
