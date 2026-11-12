import { lt, sql } from "drizzle-orm";
import { schema, type Database } from "../db/client";

const { rateLimits } = schema;

type Callback = (err: Error | null, res?: { current: number; ttl: number }) => void;
interface RouteOptions { routeInfo?: { method?: string | string[]; url?: string } }

/**
 * Postgres store for @fastify/rate-limit, so limits hold across every API instance
 * (several serverless functions, or several VPS processes) instead of per process.
 * Fixed windows: one row per key, counted with a single atomic upsert.
 */
export function createPgRateLimitStore(db: Database) {
  let lastSweep = 0;

  return class PgRateLimitStore {
    prefix: string;

    constructor(_options?: unknown, prefix = "global:") {
      this.prefix = prefix;
    }

    incr(key: string, cb: Callback, timeWindow: number) {
      const full = `${this.prefix}${key}`;
      const windowMs = Math.max(1, Math.trunc(timeWindow));
      db.execute<{ count: number; reset_at: string | Date }>(sql`
        insert into rate_limits (key, count, reset_at)
        values (${full}, 1, now() + make_interval(secs => ${windowMs / 1000}))
        on conflict (key) do update set
          count = case when rate_limits.reset_at <= now() then 1 else rate_limits.count + 1 end,
          reset_at = case when rate_limits.reset_at <= now() then now() + make_interval(secs => ${windowMs / 1000}) else rate_limits.reset_at end
        returning count, reset_at`)
        .then((result) => {
          const row = (Array.isArray(result) ? result : (result as { rows: { count: number; reset_at: string | Date }[] }).rows)[0]!;
          const ttl = Math.max(0, new Date(row.reset_at).getTime() - Date.now());
          cb(null, { current: Number(row.count), ttl });
          // Expired rows are harmless (they reset on next use); sweep them now and then.
          if (Date.now() - lastSweep > 10 * 60_000) {
            lastSweep = Date.now();
            void db.delete(rateLimits).where(lt(rateLimits.resetAt, sql`now() - interval '1 day'`)).catch(() => {});
          }
        })
        .catch((error: Error) => cb(error));
    }

    child(routeOptions: RouteOptions) {
      const { method = "", url = "" } = routeOptions.routeInfo ?? {};
      return new PgRateLimitStore(undefined, `${[method].flat().join(",")}${url}:`);
    }
  };
}
