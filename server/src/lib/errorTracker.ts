import { createHash } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { schema, type Database } from "../db/client";
import { recordEvent } from "./events";

const { appErrors } = schema;

export interface TrackedError {
  source: "server" | "client";
  message: string;
  stack?: string | null;
  method?: string | null;
  path?: string | null;
  status?: number | null;
  userId?: string | null;
}

/** Ids, numbers and query strings vary per request; strip them so the same bug groups together. */
const normalisePath = (path: string | null | undefined) =>
  (path ?? "").split("?")[0]!.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id").replace(/\/\d+(?=\/|$)/g, "/:n");
const normaliseMessage = (message: string) =>
  message.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>").replace(/\d{4,}/g, "<n>").slice(0, 300);

export const fingerprintOf = (e: Pick<TrackedError, "source" | "message" | "method" | "path">) =>
  createHash("sha256").update([e.source, normaliseMessage(e.message), e.method ?? "", normalisePath(e.path)].join("|")).digest("hex").slice(0, 32);

/**
 * Stores an error (or counts a repeat) and tells admins when it's new, when it comes back after
 * being marked resolved, or at most once an hour while it keeps happening. The "should we alert"
 * check is one atomic UPDATE, so with several API instances only one sends the alert.
 * Never throws: error tracking must not cause errors of its own.
 */
export async function trackError(db: Database, e: TrackedError) {
  try {
    const values = {
      fingerprint: fingerprintOf(e),
      source: e.source,
      message: e.message.slice(0, 1000) || "Unknown error",
      stack: e.stack?.slice(0, 8000) ?? null,
      method: e.method ?? null,
      path: e.path?.split("?")[0]?.slice(0, 300) ?? null,
      status: e.status ?? null,
      userId: e.userId ?? null,
    };
    const [row] = await db
      .insert(appErrors)
      .values(values)
      .onConflictDoUpdate({
        target: appErrors.fingerprint,
        set: {
          count: sql`${appErrors.count} + 1`,
          lastSeenAt: sql`now()`,
          stack: sql`coalesce(excluded.stack, ${appErrors.stack})`,
          userId: sql`coalesce(excluded.user_id, ${appErrors.userId})`,
          // A resolved error that happens again is open again, and alerts again straight away.
          alertedAt: sql`case when ${appErrors.resolvedAt} is not null then null else ${appErrors.alertedAt} end`,
          resolvedAt: sql`null`,
        },
      })
      .returning({ id: appErrors.id, count: appErrors.count });
    if (!row) return;

    const [claimed] = await db
      .update(appErrors)
      .set({ alertedAt: sql`now()` })
      .where(and(eq(appErrors.id, row.id), or(isNull(appErrors.alertedAt), lt(appErrors.alertedAt, sql`now() - interval '1 hour'`))))
      .returning({ id: appErrors.id });
    if (claimed) {
      await recordEvent(db, {
        type: "system.error",
        actorId: null,
        subjectId: row.id,
        payload: { message: values.message.slice(0, 200), source: e.source, path: normalisePath(e.path), status: e.status ?? null, count: row.count },
      });
    }
  } catch (error) {
    console.error("Could not record an application error", error);
  }
}
