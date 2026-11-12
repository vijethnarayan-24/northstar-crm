import { eq, sql } from "drizzle-orm";
import { schema, type Database } from "../db/client";

/**
 * Per-account login throttle, on top of the per-IP rate limit. It stops one account being
 * brute-forced from many IPs. The block is temporary (no permanent lockout), so it can't be
 * used to lock someone out for good. Unknown emails are throttled the same way, so the
 * response never reveals whether an account exists.
 *
 * Stored in Postgres so it holds across every API instance (serverless or several processes).
 */
const MAX_FAILURES = 10;
const WINDOW_SECONDS = 15 * 60;
const BLOCK_SECONDS = 15 * 60;

const { loginThrottle } = schema;

export async function isBlocked(db: Database, email: string) {
  const [row] = await db
    .select({ blocked: sql<boolean>`${loginThrottle.blockedUntil} is not null and ${loginThrottle.blockedUntil} > now()` })
    .from(loginThrottle)
    .where(eq(loginThrottle.email, email))
    .limit(1);
  return !!row?.blocked;
}

/** Records a failed attempt; returns true when this failure triggers a block. */
export async function recordFailure(db: Database, email: string) {
  const window = sql`make_interval(secs => ${WINDOW_SECONDS})`;
  const [row] = await db
    .insert(loginThrottle)
    .values({ email, failures: 1, firstAt: sql`now()` })
    .onConflictDoUpdate({
      target: loginThrottle.email,
      set: {
        // A new window starts once the old one has passed.
        failures: sql`case when ${loginThrottle.firstAt} + ${window} < now() then 1 else ${loginThrottle.failures} + 1 end`,
        firstAt: sql`case when ${loginThrottle.firstAt} + ${window} < now() then now() else ${loginThrottle.firstAt} end`,
      },
    })
    .returning({ failures: loginThrottle.failures });
  const blocked = (row?.failures ?? 0) >= MAX_FAILURES;
  if (blocked) {
    await db.update(loginThrottle).set({ blockedUntil: sql`now() + make_interval(secs => ${BLOCK_SECONDS})` }).where(eq(loginThrottle.email, email));
  }
  return blocked;
}

export async function recordSuccess(db: Database, email: string) {
  await db.delete(loginThrottle).where(eq(loginThrottle.email, email));
}

/** Test helper. */
export async function resetLoginThrottle(db: Database) {
  await db.delete(loginThrottle);
}
