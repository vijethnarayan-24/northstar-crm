/**
 * Security and integrity checks from the QA test plan (sections 5–7) that apply to this app:
 * role-by-endpoint permission matrix, IDOR, mass assignment, enumeration, brute force,
 * rate-limit bypass, session lifetime, headers, error hygiene and report reconciliation.
 */
import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DashboardDTO, LookupsDTO } from "@crm/shared";
import { buildApp } from "../src/app";
import { schema } from "../src/db/client";
import { resetLoginThrottle } from "../src/lib/loginThrottle";
import { hashToken } from "../src/lib/tokens";
import { seed } from "../scripts/seed";
import { ADMIN, AISHA, PASSWORD, RAHUL, setupApp } from "./helpers";

let ctx: Awaited<ReturnType<typeof setupApp>>;
let adminCookie: string;
let memberCookie: string;

beforeAll(async () => {
  ctx = await setupApp();
});
beforeEach(async () => {
  await resetLoginThrottle(ctx.handle.db);
  await ctx.handle.db.delete(schema.rateLimits);
  await seed(ctx.handle.db, ctx.storage);
  adminCookie = await ctx.login(ADMIN);
  memberCookie = await ctx.login(RAHUL);
});
afterAll(async () => ctx?.close());

type Access = "public" | "auth" | "admin";
/** The role-by-endpoint matrix. Every route the app registers must appear here. */
const MATRIX: Record<string, Access> = {
  "OPTIONS *": "public", // CORS preflight
  "GET /api/v1/health": "public",
  "POST /api/v1/auth/login": "public",
  "POST /api/v1/auth/logout": "public",
  "GET /api/v1/auth/invite/:token": "public",
  "POST /api/v1/auth/accept-invite": "public",
  "POST /api/v1/auth/forgot": "public",
  "POST /api/v1/auth/reset": "public",
  "GET /api/v1/share/:token": "public",
  // Not session-based: needs the CRON_SECRET bearer token (404 when CRON_SECRET is unset). See vercel.test.ts.
  "GET /api/v1/cron/jobs": "public",
  // Browsers report crashes even when signed out (e.g. on the login page); rate-limited and size-checked.
  "POST /api/v1/client-errors": "public",
  "GET /api/v1/system/status": "admin",
  "GET /api/v1/system/errors": "admin",
  "POST /api/v1/system/errors/:id/resolve": "admin",
  "POST /api/v1/system/errors/resolve-all": "admin",

  "GET /api/v1/me": "auth",
  "PATCH /api/v1/me": "auth",
  "POST /api/v1/me/password": "auth",
  "GET /api/v1/me/summary": "auth",
  "GET /api/v1/me/notification-prefs": "auth",
  "PUT /api/v1/me/notification-prefs": "auth",
  "GET /api/v1/users": "auth",
  "GET /api/v1/lookups": "auth",
  "POST /api/v1/tags": "auth",
  "GET /api/v1/leads": "auth",
  "POST /api/v1/leads": "auth",
  "GET /api/v1/leads/:id": "auth",
  "PATCH /api/v1/leads/:id": "auth",
  "DELETE /api/v1/leads/:id": "auth",
  "POST /api/v1/leads/:id/move": "auth",
  "GET /api/v1/leads/:id/activities": "auth",
  "POST /api/v1/leads/:id/activities": "auth",
  "GET /api/v1/leads/:id/tasks": "auth",
  "GET /api/v1/leads/:id/stage-history": "auth",
  "GET /api/v1/leads/:id/documents": "auth",
  "POST /api/v1/leads/:id/documents": "auth",
  "POST /api/v1/leads/:id/documents/uploads": "auth",
  "GET /api/v1/leads/:id/history": "auth",
  "GET /api/v1/reports": "auth",
  "GET /api/v1/reports/deals.csv": "auth",
  "GET /api/v1/calendar": "auth",
  "POST /api/v1/leads/:id/documents/complete": "auth",
  "PATCH /api/v1/activities/:id": "auth",
  "DELETE /api/v1/activities/:id": "auth",
  "GET /api/v1/tasks": "auth",
  "POST /api/v1/tasks": "auth",
  "GET /api/v1/tasks/stats": "auth",
  "PATCH /api/v1/tasks/:id": "auth",
  "DELETE /api/v1/tasks/:id": "auth",
  "GET /api/v1/pipeline": "auth",
  "GET /api/v1/workspace": "auth",
  "GET /api/v1/settings/sources": "auth",
  "GET /api/v1/settings/stages": "auth",
  "GET /api/v1/settings/tags": "auth",
  "GET /api/v1/dashboard": "auth",
  "GET /api/v1/feed": "auth",
  "GET /api/v1/goal": "auth",
  "GET /api/v1/documents/:id/download": "auth",
  "DELETE /api/v1/documents/:id": "auth",
  "POST /api/v1/documents/:id/share": "auth",
  "DELETE /api/v1/documents/:id/share": "auth",
  "GET /api/v1/notifications": "auth",
  "GET /api/v1/notifications/unread-count": "auth",
  "POST /api/v1/notifications/read": "auth",
  "GET /api/v1/search": "auth",

  "PATCH /api/v1/users/:id": "admin",
  "POST /api/v1/users/:id/reset-link": "admin",
  "GET /api/v1/invitations": "admin",
  "POST /api/v1/invitations": "admin",
  "POST /api/v1/invitations/:id/renew": "admin",
  "DELETE /api/v1/invitations/:id": "admin",
  "PATCH /api/v1/workspace": "admin",
  "POST /api/v1/sources": "admin",
  "PATCH /api/v1/sources/:id": "admin",
  "PUT /api/v1/sources/order": "admin",
  "DELETE /api/v1/sources/:id": "admin",
  "POST /api/v1/stages": "admin",
  "PATCH /api/v1/stages/:id": "admin",
  "PUT /api/v1/stages/order": "admin",
  "POST /api/v1/stages/:id/remove": "admin",
  "PATCH /api/v1/tags/:id": "admin",
  "DELETE /api/v1/tags/:id": "admin",
  "POST /api/v1/tags/:id/merge": "admin",
  "PUT /api/v1/goal": "admin",
};

const routes = () => [...new Set(ctx.app.routeList.map((r) => `${r.method} ${r.url.replace(/\/$/, "") || "/"}`))];
const fill = (url: string) => url.replace(":token", "x".repeat(43)).replace(/:id/g, crypto.randomUUID());

describe("permission matrix (role × endpoint)", () => {
  it("every registered route is classified", () => {
    const unclassified = routes().filter((r) => !(r in MATRIX));
    expect(unclassified, "add new endpoints to MATRIX with their access level").toEqual([]);
  });

  it("signed-out requests to non-public endpoints get 401", async () => {
    const leaks: string[] = [];
    for (const [route, access] of Object.entries(MATRIX)) {
      if (access === "public") continue;
      const [method, url] = route.split(" ");
      const res = await ctx.app.inject({ method: method as "GET", url: fill(url!), payload: method === "GET" || method === "DELETE" ? undefined : {} });
      if (res.statusCode !== 401) leaks.push(`${route} → ${res.statusCode}`);
    }
    expect(leaks).toEqual([]);
  });

  it("members get 403 from every admin-only endpoint", async () => {
    const leaks: string[] = [];
    for (const [route, access] of Object.entries(MATRIX)) {
      if (access !== "admin") continue;
      const [method, url] = route.split(" ");
      const res = await ctx.app.inject({ method: method as "GET", url: fill(url!), headers: { cookie: memberCookie }, payload: method === "GET" || method === "DELETE" ? undefined : {} });
      if (res.statusCode !== 403) leaks.push(`${route} → ${res.statusCode}`);
    }
    expect(leaks).toEqual([]);
  });

  it("a deactivated user's session stops working on every endpoint", async () => {
    const aisha = await ctx.login(AISHA);
    const lookups = (await ctx.as(adminCookie).get("/api/v1/lookups")).json() as LookupsDTO;
    await ctx.as(adminCookie).patch(`/api/v1/users/${lookups.users.find((u) => u.name === "Aisha Rahman")!.id}`, { active: false });
    expect((await ctx.as(aisha).get("/api/v1/leads")).statusCode).toBe(401);
    expect((await ctx.as(aisha).get("/api/v1/notifications")).statusCode).toBe(401);
  });
});

describe("access to other people's records (IDOR)", () => {
  it("members cannot change another owner's lead, task, activity or document", async () => {
    const rahul = ctx.as(memberCookie);
    const maya = (await rahul.get("/api/v1/leads?q=Maya")).json().items[0].id; // Aisha's
    expect((await rahul.patch(`/api/v1/leads/${maya}`, { temperature: "cold" })).statusCode).toBe(403);
    expect((await rahul.delete(`/api/v1/leads/${maya}`)).statusCode).toBe(403);
    expect((await rahul.post(`/api/v1/leads/${maya}/move`, { stageId: crypto.randomUUID() })).statusCode).toBe(403);
    const aishaTask = (await rahul.get(`/api/v1/leads/${maya}/tasks`)).json().tasks.find((t: { assignee: { name: string } }) => t.assignee.name === "Aisha Rahman");
    expect((await rahul.patch(`/api/v1/tasks/${aishaTask.id}`, { completed: true })).statusCode).toBe(403);
    expect((await rahul.delete(`/api/v1/tasks/${aishaTask.id}`)).statusCode).toBe(403);
    const activity = (await rahul.get(`/api/v1/leads/${maya}/activities`)).json().activities[0];
    expect((await rahul.patch(`/api/v1/activities/${activity.id}`, { title: "x" })).statusCode).toBe(403);
    const doc = (await rahul.get(`/api/v1/leads/${maya}/documents`)).json().documents[0];
    expect((await rahul.delete(`/api/v1/documents/${doc.id}`)).statusCode).toBe(403);
    expect((await rahul.post(`/api/v1/documents/${doc.id}/share`, {})).statusCode).toBe(403);
  });

  it("notifications are private: listing shows only mine, and marking someone else's does nothing", async () => {
    const aishaCookie = await ctx.login(AISHA);
    const rahul = ctx.as(memberCookie);
    const maya = (await rahul.get("/api/v1/leads?q=Maya")).json().items[0].id;
    await rahul.post(`/api/v1/leads/${maya}/activities`, { type: "call", title: "For Aisha" });
    const hers = (await ctx.as(aishaCookie).get("/api/v1/notifications")).json();
    expect(hers.unreadCount).toBe(1);
    expect((await rahul.get("/api/v1/notifications")).json().items).toHaveLength(0);
    await rahul.post("/api/v1/notifications/read", { ids: [hers.items[0].id] });
    expect((await ctx.as(aishaCookie).get("/api/v1/notifications")).json().unreadCount).toBe(1);
  });
});

describe("mass assignment", () => {
  it("extra fields in updates are ignored", async () => {
    const rahul = ctx.as(memberCookie);
    const me = (await rahul.patch("/api/v1/me", { name: "Rahul K", role: "admin", deactivatedAt: null, email: "x@y.z" })).json().user;
    expect(me).toMatchObject({ name: "Rahul K", role: "member", email: "rahul@northstar.agency" });
    const created = (await rahul.post("/api/v1/leads", { fullName: "Mass Assign", createdBy: crypto.randomUUID(), deletedAt: new Date().toISOString(), position: 999 })).json().lead;
    expect(created.createdBy.name).toBe("Rahul K"); // the real author, renamed above — not the injected id
    expect((await rahul.get(`/api/v1/leads/${created.id}`)).statusCode).toBe(200);
  });
});

describe("authentication attacks", () => {
  it("no username enumeration: same status and body for unknown email and wrong password", async () => {
    const a = await ctx.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: ADMIN, password: "wrong-password-1" } });
    const b = await ctx.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "nobody@northstar.agency", password: "wrong-password-1" } });
    expect([a.statusCode, a.body]).toEqual([b.statusCode, b.body]);
    const ra = await ctx.app.inject({ method: "POST", url: "/api/v1/auth/forgot", payload: { email: ADMIN } });
    const rb = await ctx.app.inject({ method: "POST", url: "/api/v1/auth/forgot", payload: { email: "nobody@northstar.agency" } });
    expect([ra.statusCode, ra.body]).toEqual([rb.statusCode, rb.body]);
  });

  it("brute force on one account is blocked even from rotating IPs, and only for that account", async () => {
    for (let i = 0; i < 10; i++) {
      await ctx.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "x-forwarded-for": `203.0.113.${i}` }, payload: { email: AISHA, password: `guess-${i}-xxxxxx` } });
    }
    const blocked = await ctx.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: AISHA, password: PASSWORD } });
    expect(blocked.statusCode).toBe(429);
    // Case variations of the same email are the same account.
    expect((await ctx.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: AISHA.toUpperCase(), password: PASSWORD } })).statusCode).toBe(429);
    expect((await ctx.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: RAHUL, password: PASSWORD } })).statusCode).toBe(200);
  });

  it("the per-IP limit can't be dodged with a spoofed X-Forwarded-For (no trusted proxy configured)", async () => {
    const limited = await buildApp(ctx.handle, { logger: false, storage: ctx.storage });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      await resetLoginThrottle(ctx.handle.db); // isolate the per-IP limit from the per-account one
      const res = await limited.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "x-forwarded-for": `198.51.100.${i}` }, payload: { email: `spray${i}@x.com`, password: "wrong-password-1" } });
      statuses.push(res.statusCode);
      if (res.statusCode === 429) expect(res.headers["retry-after"]).toBeDefined();
    }
    expect(statuses.at(-1)).toBe(429);
    await limited.close();
  });

  it("sessions end at the absolute lifetime even if used daily, and reset tokens are single-use", async () => {
    const rahulId = ((await ctx.as(adminCookie).get("/api/v1/lookups")).json() as LookupsDTO).users.find((u) => u.name === "Rahul Kapoor")!.id;
    const token = "old-but-recently-used-session-token-xxxxxxxx";
    await ctx.handle.db.insert(schema.sessions).values({ id: hashToken(token), userId: rahulId, expiresAt: new Date(Date.now() + 86_400_000), createdAt: new Date(Date.now() - 91 * 86_400_000) });
    expect((await ctx.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: `crm_sid=${token}` } })).statusCode).toBe(401);
  });

  it("a forged or tampered session cookie is rejected", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: `${memberCookie}x` } })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: "crm_sid=" } })).statusCode).toBe(401);
  });
});

describe("transport, headers and error hygiene", () => {
  it("sets security headers and no-store on API responses", async () => {
    const res = await ctx.as(memberCookie).get("/api/v1/leads");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("CORS only allows configured origins", async () => {
    const ok = await ctx.app.inject({ method: "OPTIONS", url: "/api/v1/leads", headers: { origin: "http://localhost:8443", "access-control-request-method": "GET" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:8443");
    const bad = await ctx.app.inject({ method: "OPTIONS", url: "/api/v1/leads", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } });
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("errors are JSON without stack traces or SQL", async () => {
    const malformed = await ctx.app.inject({ method: "POST", url: "/api/v1/leads", headers: { cookie: memberCookie, "content-type": "application/json" }, payload: "{not json" });
    expect(malformed.statusCode).toBe(400);
    const badId = await ctx.as(memberCookie).get("/api/v1/leads/not-a-uuid");
    expect(badId.statusCode).toBe(400);
    for (const res of [malformed, badId]) {
      expect(res.body).not.toMatch(/at \w+ \(|stack|select |postgres|drizzle/i);
    }
  });

  it("rejects oversized JSON bodies", async () => {
    const huge = JSON.stringify({ fullName: "x", pinnedNote: "y".repeat(2 * 1024 * 1024) });
    const res = await ctx.app.inject({ method: "POST", url: "/api/v1/leads", headers: { cookie: memberCookie, "content-type": "application/json" }, payload: huge });
    expect(res.statusCode).toBe(413);
  });

  it("stores script-like text verbatim as data (the UI escapes it on render)", async () => {
    const name = `<img src=x onerror=alert(1)> "Robert'); DROP TABLE leads;--`;
    const res = await ctx.as(memberCookie).post("/api/v1/leads", { fullName: name, company: "=HYPERLINK(\"http://evil\")" });
    expect(res.statusCode).toBe(201);
    expect(res.json().lead.fullName).toBe(name);
    expect((await ctx.as(memberCookie).get("/api/v1/leads")).statusCode).toBe(200); // table still there
  });
});

describe("report accuracy: dashboard reconciled against direct SQL", () => {
  it("every KPI and chart total equals a direct database query", async () => {
    const { leads, pipelineStages } = schema;
    const db = ctx.handle.db;
    const d = (await ctx.as(adminCookie).get("/api/v1/dashboard?range=30d")).json() as DashboardDTO;
    const since = sql`now() - interval '30 days'`;
    const [[created], [hot], [won], [open], [all]] = await Promise.all([
      db.select({ n: count() }).from(leads).where(and(isNull(leads.deletedAt), gte(leads.createdAt, since))),
      db.select({ n: count() }).from(leads).innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId)).where(and(isNull(leads.deletedAt), eq(pipelineStages.kind, "open"), eq(leads.temperature, "hot"))),
      db.select({ n: count(), v: sql<number>`coalesce(sum(${leads.valueCents}),0)::float8`.mapWith(Number) }).from(leads).innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId)).where(and(isNull(leads.deletedAt), eq(pipelineStages.kind, "won"), gte(leads.wonAt, since))),
      db.select({ n: count(), v: sql<number>`coalesce(sum(${leads.valueCents}),0)::float8`.mapWith(Number) }).from(leads).innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId)).where(and(isNull(leads.deletedAt), eq(pipelineStages.kind, "open"))),
      db.select({ n: count() }).from(leads).where(isNull(leads.deletedAt)),
    ]);
    expect(d.kpis.newLeads.value).toBe(created!.n);
    expect(d.kpis.hotLeads.value).toBe(hot!.n);
    expect([d.kpis.dealsWon.value, d.kpis.wonValueCents.value]).toEqual([won!.n, won!.v]);
    expect([d.kpis.openDeals, d.kpis.pipelineValueCents.value]).toEqual([open!.n, open!.v]);
    expect(d.bySource.reduce((n, s) => n + s.count, 0)).toBe(created!.n);
    expect(d.byStage.reduce((n, s) => n + s.count, 0)).toBe(all!.n);
  });
});
