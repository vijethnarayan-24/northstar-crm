import { expect } from "vitest";
import { buildApp } from "../src/app";
import { openDatabase } from "../src/db/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemoryMailer } from "../src/lib/mailer";
import { createLocalStorage } from "../src/lib/storage";

export const PASSWORD = process.env.SEED_PASSWORD || "northstar-dev-only";
export const ADMIN = "alex@northstar.agency";
export const AISHA = "aisha@northstar.agency";
export const RAHUL = "rahul@northstar.agency";

/** Fresh in-memory database + app for a test file. */
export async function setupApp() {
  const handle = await openDatabase({ dataDir: "memory://" });
  await handle.migrate();
  const mailer = createMemoryMailer();
  const storageDir = mkdtempSync(path.join(tmpdir(), "crm-test-uploads-"));
  const storage = createLocalStorage(storageDir);
  const app = await buildApp(handle, { logger: false, mailer, storage, rateLimit: false });

  const login = async (email: string, password = PASSWORD) => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
    expect(res.statusCode, res.body).toBe(200);
    return `crm_sid=${res.cookies.find((c) => c.name === "crm_sid")!.value}`;
  };

  /** Authenticated request helper bound to a cookie. */
  const as = (cookie: string) => ({
    get: (url: string) => app.inject({ method: "GET", url, headers: { cookie } }),
    post: (url: string, payload: object = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload }),
    patch: (url: string, payload: object) => app.inject({ method: "PATCH", url, headers: { cookie }, payload }),
    put: (url: string, payload: object) => app.inject({ method: "PUT", url, headers: { cookie }, payload }),
    delete: (url: string) => app.inject({ method: "DELETE", url, headers: { cookie } }),
  });

  const close = async () => {
    await app.close();
    await handle.close();
    rmSync(storageDir, { recursive: true, force: true });
  };

  return { app, handle, mailer, storage, login, as, close };
}
