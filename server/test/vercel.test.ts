import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

// Must be set before src/env.ts is first imported.
vi.hoisted(() => {
  process.env.CRON_SECRET = "test-cron-secret-0123456789";
});

import { buildApp } from "../src/app";
import { schema } from "../src/db/client";
import { runJobsIfDue } from "../src/jobs";
import type { Storage } from "../src/lib/storage";
import { seed } from "../scripts/seed";
import { ADMIN, PASSWORD, RAHUL, setupApp } from "./helpers";

/**
 * Behaviour specific to the Vercel deployment: direct-to-Blob uploads, presigned downloads,
 * the cron endpoint and the once-per-interval job lock. Blob is replaced by a fake with the
 * same optional Storage methods, backed by the local test storage.
 */
let ctx: Awaited<ReturnType<typeof setupApp>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const issued = new Map<string, { contentType: string; maxBytes: number }>();
const types = new Map<string, string>();
let objectStore: Storage;

/** Plays the browser's part: puts bytes in the "Blob store" under the issued pathname. */
const browserUpload = async (pathname: string, bytes: string, contentType = issued.get(pathname)!.contentType) => {
  types.set(pathname, contentType);
  await ctx.storage.save(pathname, Readable.from(Buffer.from(bytes)), 1e9);
};

let cookie: string;
let member: string;
const inject = (method: "GET" | "POST", url: string, payload?: object, who = cookie) => app.inject({ method, url, headers: { cookie: who }, payload });
const leadId = async (name: string) => (await inject("GET", `/api/v1/leads?q=${encodeURIComponent(name)}`)).json().items[0].id as string;

beforeAll(async () => {
  ctx = await setupApp();
  objectStore = {
    ...ctx.storage,
    async createUpload(key, options) {
      issued.set(key, options);
      return { clientToken: `token-for:${key}` };
    },
    async stat(key) {
      const file = await ctx.storage.open(key);
      if (!file) return null;
      file.stream.destroy();
      return { size: file.size, contentType: types.get(key) ?? "application/octet-stream" };
    },
    async signedUrl(key) {
      return `https://blob.example/${key}?signed=1`;
    },
  };
  app = await buildApp(ctx.handle, { logger: false, storage: objectStore, rateLimit: false });
});
beforeEach(async () => {
  await seed(ctx.handle.db, ctx.storage);
  const login = async (email: string) => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: PASSWORD } });
    return `crm_sid=${res.cookies.find((c) => c.name === "crm_sid")!.value}`;
  };
  cookie = await login(ADMIN);
  member = await login(RAHUL);
});
afterAll(async () => {
  await app?.close();
  await ctx?.close();
});

describe("direct uploads (Vercel Blob)", () => {
  it("issues a one-file token, then records the document once the file is in storage", async () => {
    const maya = await leadId("Maya Chen");
    const start = await inject("POST", `/api/v1/leads/${maya}/documents/uploads`, { filename: "Proposal – v2 (final).pdf", sizeBytes: 14 }, member);
    expect(start.statusCode, start.body).toBe(200);
    const { direct } = start.json();
    expect(direct.contentType).toBe("application/pdf");
    expect(direct.pathname).toMatch(new RegExp(`^${maya}/[0-9a-f-]{36}/Proposal-v2-final\\.pdf$`));
    expect(issued.get(direct.pathname)).toEqual({ contentType: "application/pdf", maxBytes: 25 * 1024 * 1024 });

    // Finishing before the file arrives fails cleanly.
    expect((await inject("POST", `/api/v1/leads/${maya}/documents/complete`, { pathname: direct.pathname, filename: "Proposal – v2 (final).pdf" }, member)).statusCode).toBe(400);

    await browserUpload(direct.pathname, "%PDF-1.4 hello");
    const done = await inject("POST", `/api/v1/leads/${maya}/documents/complete`, { pathname: direct.pathname, filename: "Proposal – v2 (final).pdf" }, member);
    expect(done.statusCode, done.body).toBe(201);
    expect(done.json().document).toMatchObject({ filename: "Proposal – v2 (final).pdf", sizeBytes: 14, mimeType: "application/pdf", uploadedBy: { name: "Rahul Kapoor" } });

    // The same upload can't be recorded twice.
    expect((await inject("POST", `/api/v1/leads/${maya}/documents/complete`, { pathname: direct.pathname, filename: "again.pdf" }, member)).statusCode).toBe(409);
  });

  it("refuses bad types, oversize files, paths for other leads and mismatched content", async () => {
    const maya = await leadId("Maya Chen");
    const owen = await leadId("Owen Wright");
    expect((await inject("POST", `/api/v1/leads/${maya}/documents/uploads`, { filename: "run.exe", sizeBytes: 10 })).statusCode).toBe(415);
    expect((await inject("POST", `/api/v1/leads/${maya}/documents/uploads`, { filename: "big.pdf", sizeBytes: 26 * 1024 * 1024 })).statusCode).toBe(413);
    expect((await inject("POST", `/api/v1/leads/${maya}/documents/uploads`, { filename: "empty.pdf", sizeBytes: 0 })).statusCode).toBe(400);

    const { direct } = (await inject("POST", `/api/v1/leads/${maya}/documents/uploads`, { filename: "notes.pdf", sizeBytes: 5 })).json();
    await browserUpload(direct.pathname, "hello");
    // A path issued for Maya can't be attached to Owen, and a made-up path is refused.
    expect((await inject("POST", `/api/v1/leads/${owen}/documents/complete`, { pathname: direct.pathname, filename: "notes.pdf" })).statusCode).toBe(400);
    expect((await inject("POST", `/api/v1/leads/${maya}/documents/complete`, { pathname: `${maya}/../secrets.pdf`, filename: "x.pdf" })).statusCode).toBe(400);
    // The stored type must match the name, otherwise the file is removed.
    const { direct: other } = (await inject("POST", `/api/v1/leads/${maya}/documents/uploads`, { filename: "photo.png", sizeBytes: 5 })).json();
    await browserUpload(other.pathname, "hello", "text/html");
    expect((await inject("POST", `/api/v1/leads/${maya}/documents/complete`, { pathname: other.pathname, filename: "photo.png" })).statusCode).toBe(400);
    expect(await objectStore.stat!(other.pathname)).toBeNull();
  });

  it("downloads and share links redirect to a short-lived private link after the usual checks", async () => {
    const maya = await leadId("Maya Chen");
    const { direct } = (await inject("POST", `/api/v1/leads/${maya}/documents/uploads`, { filename: "deck.pdf", sizeBytes: 4 })).json();
    await browserUpload(direct.pathname, "%PDF");
    const doc = (await inject("POST", `/api/v1/leads/${maya}/documents/complete`, { pathname: direct.pathname, filename: "deck.pdf" })).json().document;

    const download = await inject("GET", `/api/v1/documents/${doc.id}/download`);
    expect(download.statusCode).toBe(302);
    expect(download.headers.location).toBe(`https://blob.example/${direct.pathname}?signed=1`);
    expect(download.headers["cache-control"]).toContain("no-store");
    expect((await app.inject({ method: "GET", url: `/api/v1/documents/${doc.id}/download` })).statusCode).toBe(401);

    const share = (await inject("POST", `/api/v1/documents/${doc.id}/share`, { expiresInDays: 7 })).json();
    const viewed = await app.inject({ method: "GET", url: new URL(share.shareUrl).pathname });
    expect(viewed.statusCode).toBe(302);
    expect(viewed.headers["referrer-policy"]).toBe("no-referrer");
  });
});

describe("cron and job lock", () => {
  it("the cron endpoint needs the secret", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/cron/jobs" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/v1/cron/jobs", headers: { authorization: "Bearer wrong-secret-wrong-secret" } })).statusCode).toBe(401);
    await ctx.handle.db.delete(schema.jobRuns);
    const ok = await app.inject({ method: "GET", url: "/api/v1/cron/jobs", headers: { authorization: "Bearer test-cron-secret-0123456789" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().ran).toBe(true);
  });

  it("runs at most once per interval, however many instances ask", async () => {
    await ctx.handle.db.delete(schema.jobRuns);
    const results = await Promise.all(Array.from({ length: 5 }, () => runJobsIfDue(ctx.handle.db, 15)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await runJobsIfDue(ctx.handle.db, 15)).toBeNull();
    // Once the interval has passed, the next caller runs them again.
    await ctx.handle.db.update(schema.jobRuns).set({ lastRunAt: sql`now() - interval '16 minutes'` });
    expect(await runJobsIfDue(ctx.handle.db, 15)).not.toBeNull();
  });
});
