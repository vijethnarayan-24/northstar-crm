// Builds the whole app for Vercel using the Build Output API (https://vercel.com/docs/build-output-api):
//   .vercel/output/static            the Vite frontend
//   .vercel/output/functions/api.func  the Fastify API bundled into one Node.js function
//   .vercel/output/config.json         routing (SPA fallback, /api → function) and the daily cron
// Also applies database migrations when DATABASE_URL is set, so each deploy's schema is current.
//
// Run by Vercel as the build command (see vercel.json). Locally: `pnpm build:vercel`.
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = path.join(root, "server");
const out = path.join(root, ".vercel", "output");
const fn = path.join(out, "functions", "api.func");
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit" });
const log = (msg) => console.log(`\n▲ ${msg}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

// 1. Frontend.
log("Building the frontend");
run("pnpm build");
cpSync(path.join(root, "dist"), path.join(out, "static"), { recursive: true });

// 2. Database migrations (skipped when no database is configured, e.g. a first test build).
if (process.env.DATABASE_URL) {
  log("Applying database migrations");
  // Use the direct (unpooled) connection for DDL when the provider offers one (Neon does).
  const migrateUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  execSync("pnpm --filter @crm/server db:migrate", { cwd: root, stdio: "inherit", env: { ...process.env, DATABASE_URL: migrateUrl } });
} else {
  console.warn("\n⚠ DATABASE_URL is not set: skipping migrations. The API needs it at runtime.");
}

// 3. API function: one ESM bundle with the shared package inlined.
log("Bundling the API");
const esbuild = createRequire(path.join(server, "package.json"))("esbuild");
await esbuild.build({
  entryPoints: [path.join(server, "src", "vercel.ts")],
  outfile: path.join(fn, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: "linked",
  // Native addon (copied below) and the dev-only embedded database (never loaded when DATABASE_URL is set).
  // (drizzle-orm/pglite too: inlined, its static import of pglite would load at startup.)
  external: ["@node-rs/argon2", "@electric-sql/pglite", "@electric-sql/pglite/*", "drizzle-orm/pglite", "drizzle-orm/pglite/*", "pg-native"],
  // CommonJS dependencies inside an ESM bundle still call require().
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});

// The argon2 password hasher is a native addon: copy its loader plus the platform build that
// pnpm installed on this machine (linux-x64-gnu on Vercel's build image).
const argonDir = realpathSync(path.join(server, "node_modules", "@node-rs", "argon2"));
const scopeDir = path.dirname(argonDir);
const nodeRs = path.join(fn, "node_modules", "@node-rs");
mkdirSync(nodeRs, { recursive: true });
const argonPackages = readdirSync(scopeDir).filter((name) => name === "argon2" || name.startsWith("argon2-"));
for (const name of argonPackages) cpSync(realpathSync(path.join(scopeDir, name)), path.join(nodeRs, name), { recursive: true, dereference: true });
if (argonPackages.length < 2) throw new Error(`No platform build of @node-rs/argon2 found next to ${argonDir}`);

writeFileSync(path.join(fn, "package.json"), JSON.stringify({ type: "module" }, null, 2));
writeFileSync(
  path.join(fn, ".vc-config.json"),
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, supportsResponseStreaming: true, maxDuration: 30, regions: [process.env.API_REGION || "sin1"] }, null, 2),
);

// The function runs in one region; keep it next to the database (Neon: sin1, Singapore).
// 4. Routing and the scheduled job.
writeFileSync(
  path.join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        // Everything under /api goes to the one API function, keeping the original path.
        { src: "^/api/(.*)$", dest: "/api?__path=$1" },
        // Hashed build assets never change.
        { src: "^/assets/(.*)$", headers: { "cache-control": "public, max-age=31536000, immutable" }, continue: true },
        { handle: "filesystem" },
        // Single-page app: every other path renders index.html.
        { src: "^/(.*)$", dest: "/index.html" },
      ],
      // Daily backstop for reminders and clean-up (works on every plan); traffic triggers them more often.
      crons: [{ path: "/api/v1/cron/jobs", schedule: "0 6 * * *" }],
    },
    null,
    2,
  ),
);

log(`Done: ${path.relative(root, out)} (static + api.func with ${argonPackages.join(", ")})`);
if (!existsSync(path.join(out, "static", "index.html"))) throw new Error("Frontend build is missing index.html");
