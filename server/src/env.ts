import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().default(4000),
  /** Postgres connection string. When unset outside production, an embedded PGlite database is used. */
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default(path.join(serverRoot, ".data", "pglite")),
  /** Comma-separated list of origins allowed to call the API with cookies. */
  WEB_ORIGIN: z.string().default("http://localhost:8443,http://localhost:8444"),
  /** Public URL of the web app, used to build invite and password-reset links. */
  APP_URL: z.string().url().default(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:8443"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Absolute session lifetime: a session ends this long after sign-in even if used daily. */
  SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  /**
   * Which reverse proxies may set X-Forwarded-For (used for client IPs in rate limits and logs).
   * "false" = none (direct traffic), a number = hop count, or IPs/CIDRs ("127.0.0.1,10.0.0.0/8").
   * Never "true" on a public port: clients could spoof their IP and dodge rate limits.
   * Defaults to the local proxy (127.0.0.1) in production, none in development.
   */
  TRUST_PROXY: z.string().optional(),
  /** Where uploaded documents are stored on disk. Back this folder up with the database. */
  STORAGE_DIR: z.string().default(path.join(serverRoot, ".data", "uploads")),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(500).default(25),
  /** Vercel Blob read-write token. When set, documents go to a private Blob store instead of STORAGE_DIR. */
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  /** Secret Vercel Cron sends as "Authorization: Bearer …" to /api/v1/cron/jobs. Unset = that endpoint is off. */
  CRON_SECRET: z.string().min(16).optional(),
  /** Max Postgres connections per API instance. Keep it small on serverless (every function instance has its own pool). */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(process.env.VERCEL ? 3 : 10),
  /** Run reminder and clean-up jobs in this process. Enable on exactly one API instance. */
  JOBS_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  JOBS_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  LOG_LEVEL:z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;

if (env.NODE_ENV === "production" && !env.DATABASE_URL) {
  console.error("DATABASE_URL is required in production.");
  process.exit(1);
}

/** Parsed TRUST_PROXY for Fastify's `trustProxy` option. */
export const trustProxy: boolean | string | ((address: string, hop: number) => boolean) = (() => {
  // On Vercel every request arrives through Vercel's edge, which sets X-Forwarded-For to the real
  // client IP (overwriting whatever the client sent), so trusting it is safe there.
  const raw = env.TRUST_PROXY ?? (process.env.VERCEL ? "true" : env.NODE_ENV === "production" ? "127.0.0.1" : "false");
  if (raw === "false") return false;
  if (raw === "true") return true;
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    return (_address: string, hop: number) => hop < hops;
  }
  return raw;
})();

export const paths = {
  serverRoot,
  migrations: path.join(serverRoot, "drizzle"),
};
