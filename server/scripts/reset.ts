import { rm } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { openDatabase } from "../src/db/client";
import { env } from "../src/env";
import { seed } from "./seed";

if (env.NODE_ENV === "production") {
  console.error("Refusing to reset a production database.");
  process.exit(1);
}

// Uploaded files belong to the database being dropped.
await rm(env.STORAGE_DIR, { recursive: true, force: true });

if (!env.DATABASE_URL) {
  // Embedded PGlite: start from an empty data folder. (Dropping the schema in place crashes
  // PGlite once the pg_trgm extension is installed.)
  await rm(env.PGLITE_DIR, { recursive: true, force: true });
}

const handle = await openDatabase();
if (handle.driver === "postgres") {
  await handle.db.execute(sql`drop schema if exists public cascade`);
  await handle.db.execute(sql`drop schema if exists drizzle cascade`);
  await handle.db.execute(sql`create schema public`);
}
await handle.migrate();
await seed(handle.db);
console.log(`Database reset and seeded (${handle.driver}).`);
await handle.close();
