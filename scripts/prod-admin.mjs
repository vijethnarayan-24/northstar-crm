// Creates (or restores) an admin on the PRODUCTION database of the linked Vercel project.
//
//   node scripts/prod-admin.mjs --email you@company.com --name "Your Name"
//   node scripts/prod-admin.mjs --email you@company.com --reset-password
//
// Fetches the production env vars into a temporary file, runs server/scripts/create-admin.ts
// with them, then deletes the file. The temporary password is printed in YOUR terminal only.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(path.join(tmpdir(), "crm-prod-env-"));
const file = path.join(dir, ".env");
const shell = process.platform === "win32";
// With shell: true (needed on Windows for vercel/pnpm), arguments with spaces must be quoted.
const q = (arg) => (shell && /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);

try {
  execFileSync("vercel", ["env", "pull", q(file), "--environment=production", "--yes"], { cwd: root, stdio: ["ignore", "ignore", "inherit"], shell });
  const vars = Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^"(.*)"$/, "$1")]),
  );
  const databaseUrl = vars.DATABASE_URL_UNPOOLED || vars.DATABASE_URL;
  if (!databaseUrl) throw new Error("The linked Vercel project has no DATABASE_URL for production.");
  const result = spawnSync("pnpm", ["--filter", "@crm/server", "exec", "tsx", "scripts/create-admin.ts", ...process.argv.slice(2).map(q)], {
    cwd: root,
    stdio: "inherit",
    shell,
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "production" },
  });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
