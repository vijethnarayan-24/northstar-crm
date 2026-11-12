import { defineConfig } from "drizzle-kit";

// Only used by `drizzle-kit generate` to diff the schema into SQL migrations;
// migrations are applied at runtime by scripts/migrate.ts for either driver.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  strict: true,
});
