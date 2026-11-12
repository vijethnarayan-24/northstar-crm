import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { AppErrorDTO, NotificationPageDTO, SystemStatusDTO } from "@crm/shared";
import { buildApp } from "../src/app";
import { schema } from "../src/db/client";
import { fingerprintOf, trackError } from "../src/lib/errorTracker";
import { seed } from "../scripts/seed";
import { ADMIN, PASSWORD, RAHUL, setupApp } from "./helpers";

/** Error tracking, admin alerts and the System status endpoints. */
let ctx: Awaited<ReturnType<typeof setupApp>>;
let app: Awaited<ReturnType<typeof buildApp>>;
let admin: string;
let member: string;
const get = (url: string, cookie = admin) => app.inject({ method: "GET", url, headers: { cookie } });
const post = (url: string, payload: object = {}, cookie = admin) => app.inject({ method: "POST", url, headers: { cookie }, payload });
const openErrors = async () => (await get("/api/v1/system/errors")).json().errors as AppErrorDTO[];
const adminAlerts = async () => ((await get("/api/v1/notifications")).json() as NotificationPageDTO).items.filter((n) => n.event.type === "system.error");

beforeAll(async () => {
  ctx = await setupApp();
  app = await buildApp(ctx.handle, { logger: false, storage: ctx.storage, rateLimit: false });
  // A route that always crashes, to exercise the real error handler.
  app.get("/api/v1/test/boom/:id", async () => { throw new Error("Kaboom while loading report 123456"); });
});
beforeEach(async () => {
  await seed(ctx.handle.db, ctx.storage);
  await ctx.handle.db.delete(schema.appErrors);
  const login = async (email: string) => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: PASSWORD } });
    return `crm_sid=${res.cookies.find((c) => c.name === "crm_sid")!.value}`;
  };
  admin = await login(ADMIN);
  member = await login(RAHUL);
});
afterAll(async () => {
  await app?.close();
  await ctx?.close();
});

describe("server errors", () => {
  it("are recorded, grouped across ids and numbers, and alert admins once", async () => {
    const res = await get("/api/v1/test/boom/0b676806-6f40-4ea1-9b38-1e5b450eef07", member);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal_error", message: "Something went wrong" }); // no internals leak
    await get("/api/v1/test/boom/11111111-2222-3333-4444-555555555555", member);

    const errors = await openErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ source: "server", status: 500, method: "GET", count: 2, user: { name: "Rahul Kapoor" }, resolvedAt: null });
    expect(errors[0]!.stack).toContain("Kaboom");

    const alerts = await adminAlerts();
    expect(alerts).toHaveLength(1); // second occurrence within the hour doesn't alert again
    expect(alerts[0]!.event.payload).toMatchObject({ source: "server", path: "/api/v1/test/boom/:id" });
    // Members never get the alert, and it never shows in the team feed.
    expect(((await get("/api/v1/notifications", member)).json() as NotificationPageDTO).items.some((n) => n.event.type === "system.error")).toBe(false);
    expect((await get("/api/v1/feed?type=system.error", member)).json().events).toHaveLength(0);
  });

  it("a resolved error that comes back reopens and alerts again; hourly repeat alerts", async () => {
    await get("/api/v1/test/boom/1");
    const [first] = await openErrors();
    expect(await adminAlerts()).toHaveLength(1);
    expect((await post(`/api/v1/system/errors/${first!.id}/resolve`)).statusCode).toBe(204);
    expect(await openErrors()).toHaveLength(0);
    expect((await get("/api/v1/system/errors?status=resolved")).json().errors).toHaveLength(1);

    await get("/api/v1/test/boom/2");
    expect(await openErrors()).toMatchObject([{ id: first!.id, count: 2, resolvedAt: null }]);
    expect(await adminAlerts()).toHaveLength(2); // came back after being resolved

    await get("/api/v1/test/boom/3");
    expect(await adminAlerts()).toHaveLength(2); // repeats within the hour stay quiet
    await ctx.handle.db.update(schema.appErrors).set({ alertedAt: sql`now() - interval '2 hours'` });
    await get("/api/v1/test/boom/4");
    expect(await adminAlerts()).toHaveLength(3); // still happening an hour later
  });
});

describe("browser errors", () => {
  it("can be reported signed out or in, are validated, and grouped", async () => {
    const report = { message: "Cannot read properties of undefined (reading 'name')", stack: "TypeError: ...\n at LeadDetail", path: "/leads/0b676806-6f40-4ea1-9b38-1e5b450eef07", source: "react" };
    expect((await app.inject({ method: "POST", url: "/api/v1/client-errors", payload: report })).statusCode).toBe(204);
    expect((await post("/api/v1/client-errors", { ...report, path: "/leads/11111111-2222-3333-4444-555555555555" }, member)).statusCode).toBe(204);
    const errors = await openErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ source: "client", count: 2, user: { name: "Rahul Kapoor" } });
    expect((await app.inject({ method: "POST", url: "/api/v1/client-errors", payload: { message: "" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/v1/client-errors", payload: { message: "x".repeat(600) } })).statusCode).toBe(400);
  });

  it("fingerprints ignore ids and long numbers but not the route", () => {
    const a = fingerprintOf({ source: "client", message: "Failed 12345", path: "/leads/0b676806-6f40-4ea1-9b38-1e5b450eef07" });
    const b = fingerprintOf({ source: "client", message: "Failed 99999", path: "/leads/11111111-2222-3333-4444-555555555555?tab=x" });
    const c = fingerprintOf({ source: "client", message: "Failed 12345", path: "/tasks" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("tracking never throws, even if the database write fails", async () => {
    const broken = { ...ctx.handle.db, insert: () => { throw new Error("db down"); } } as unknown as typeof ctx.handle.db;
    await expect(trackError(broken, { source: "server", message: "x" })).resolves.toBeUndefined();
  });
});

describe("system status", () => {
  it("reports database, jobs, errors and setup for admins only", async () => {
    await get("/api/v1/test/boom/1", member);
    const s = (await get("/api/v1/system/status")).json() as SystemStatusDTO;
    expect(s.database.ok).toBe(true);
    expect(s.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(s.errors.open).toBe(1);
    expect(s.overall).toBe("degraded");
    expect(s.storage).toBe("disk");
    expect(s.email.configured).toBe(false);
    for (const url of ["/api/v1/system/status", "/api/v1/system/errors"]) expect((await get(url, member)).statusCode).toBe(403);
    expect((await post("/api/v1/system/errors/resolve-all", {}, member)).statusCode).toBe(403);
    expect((await post("/api/v1/system/errors/resolve-all")).json()).toEqual({ resolved: 1 });
    expect((await get("/api/v1/system/status")).json().errors.open).toBe(0);
  });
});
