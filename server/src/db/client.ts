import { mkdirSync } from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { env, paths } from "../env";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Database;
  driver: "postgres" | "pglite";
  migrate: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * node-postgres already treats sslmode=require/prefer/verify-ca as verify-full (certificate
 * checked) but logs a security warning on every cold start; say verify-full explicitly instead.
 * Same behaviour, no warning.
 */
function withExplicitSslMode(connectionString: string) {
  return connectionString.replace(/([?&]sslmode=)(require|prefer|verify-ca)\b/, "$1verify-full");
}

/**
 * Opens the database. Uses node-postgres when DATABASE_URL is set; otherwise an
 * embedded PGlite instance on disk (or in memory when dataDir is "memory://").
 */
export async function openDatabase(options: { dataDir?: string } = {}): Promise<DbHandle> {
  if (env.DATABASE_URL && !options.dataDir) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: withExplicitSslMode(env.DATABASE_URL), max: env.DB_POOL_MAX });
    if (process.env.VERCEL) {
      // Closes idle connections before a Vercel Function instance suspends, so a thawed
      // instance never reuses a socket the database has already dropped.
      const { attachDatabasePool } = await import("@vercel/functions");
      attachDatabasePool(pool);
    }
    const db = drizzle(pool, { schema });
    return {
      db: db as unknown as Database,
      driver: "postgres",
      migrate: () => migrate(db, { migrationsFolder: paths.migrations }),
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = options.dataDir ?? env.PGLITE_DIR;
  if (!dataDir.startsWith("memory://")) mkdirSync(dataDir, { recursive: true });
  // pg_trgm backs the trigram search indexes (migration 0002); real Postgres ships it as a contrib extension.
  const client = new PGlite(dataDir, { extensions: { pg_trgm } });
  const db = drizzle(client, { schema });
  return {
    db: db as unknown as Database,
    driver: "pglite",
    migrate: () => migrate(db, { migrationsFolder: paths.migrations }),
    close: () => client.close(),
  };
}

export { schema };
