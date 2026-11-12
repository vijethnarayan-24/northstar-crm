/**
 * Volume check (test plan §8): the main endpoints stay fast with a few years of data.
 * Runs on in-memory PGlite (single-threaded WASM Postgres), so absolute times are a
 * pessimistic stand-in for a real PostgreSQL server; the staging load test is the real gate.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LookupsDTO } from "@crm/shared";
import { schema } from "../src/db/client";
import { seed } from "../scripts/seed";
import { ADMIN, setupApp } from "./helpers";

const LEADS = 5_000;
const TASKS = 5_000;
const ACTIVITIES = 10_000;
const BUDGET_MS = 1_500;

let ctx: Awaited<ReturnType<typeof setupApp>>;
let admin: ReturnType<typeof ctx.as>;
const timings: Record<string, number> = {};

beforeAll(async () => {
  ctx = await setupApp();
  await seed(ctx.handle.db, ctx.storage);
  admin = ctx.as(await ctx.login(ADMIN));
  const lookups = (await admin.get("/api/v1/lookups")).json() as LookupsDTO;
  const db = ctx.handle.db;
  const words = ["Acme", "Globex", "Initech", "Umbrella", "Stark", "Wayne", "Hooli", "Vandelay", "Soylent", "Tyrell"];
  const now = Date.now();
  const leadIds: string[] = [];
  for (let start = 0; start < LEADS; start += 500) {
    const rows = Array.from({ length: Math.min(500, LEADS - start) }, (_, k) => {
      const i = start + k;
      const stage = lookups.stages[i % lookups.stages.length]!;
      return {
        fullName: `Volume Lead ${i}`,
        company: `${words[i % words.length]} ${Math.floor(i / 10)}`,
        email: `lead${i}@example.com`,
        sourceId: lookups.sources[i % lookups.sources.length]!.id,
        temperature: (["hot", "warm", "cold"] as const)[i % 3],
        stageId: stage.id,
        position: i,
        valueCents: (i % 50) * 100_000,
        ownerId: lookups.users[i % lookups.users.length]!.id,
        nextFollowupAt: new Date(now + ((i % 30) - 10) * 86_400_000),
        wonAt: stage.kind === "won" ? new Date(now - (i % 300) * 86_400_000) : null,
        lostAt: stage.kind === "lost" ? new Date(now - (i % 300) * 86_400_000) : null,
        lostReason: stage.kind === "lost" ? ("budget" as const) : null,
        createdAt: new Date(now - (i % 1000) * 86_400_000),
      };
    });
    leadIds.push(...(await db.insert(schema.leads).values(rows).returning({ id: schema.leads.id })).map((r) => r.id));
  }
  for (let start = 0; start < TASKS; start += 1000) {
    await db.insert(schema.tasks).values(Array.from({ length: 1000 }, (_, k) => ({ title: `Volume task ${start + k}`, leadId: leadIds[(start + k) % leadIds.length], assigneeId: lookups.users[k % lookups.users.length]!.id, dueAt: new Date(now + ((k % 20) - 5) * 86_400_000) })));
  }
  for (let start = 0; start < ACTIVITIES; start += 1000) {
    await db.insert(schema.activities).values(Array.from({ length: 1000 }, (_, k) => ({ leadId: leadIds[(start + k) % leadIds.length]!, type: "call" as const, title: `Volume call ${start + k}` })));
    await db.insert(schema.events).values(Array.from({ length: 1000 }, (_, k) => ({ type: "activity.logged" as const, leadId: leadIds[(start + k) % leadIds.length]!, payload: { activityType: "call", title: "Volume" } })));
  }
}, 300_000);

afterAll(async () => {
  // Timings for the QA report (console output is hidden by the runner).
  writeFileSync(path.join(tmpdir(), "crm-volume-timings.json"), JSON.stringify(timings, null, 2));
  await ctx?.close();
});

const timed = async (label: string, url: string) => {
  const t0 = performance.now();
  const res = await admin.get(url);
  timings[label] = Math.round(performance.now() - t0);
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  return res;
};

describe(`volume: ${LEADS} leads, ${TASKS} tasks, ${ACTIVITIES} activities/events`, () => {
  it("lead list: first page, filtered + sorted, deep page", async () => {
    await timed("leads p1", "/api/v1/leads");
    await timed("leads filtered", "/api/v1/leads?temperature=hot&sort=valueCents&dir=desc");
    const deep = await timed("leads page 150", "/api/v1/leads?page=150");
    expect(deep.json().items).toHaveLength(25);
    for (const k of ["leads p1", "leads filtered", "leads page 150"]) expect(timings[k]).toBeLessThan(BUDGET_MS);
  });

  it("search, dashboard, feed, tasks", async () => {
    await timed("search", "/api/v1/search?q=globex 4");
    await timed("dashboard 365d", "/api/v1/dashboard?range=365d");
    await timed("feed", "/api/v1/feed?limit=30");
    await timed("tasks today", "/api/v1/tasks?view=today&assigneeId=me");
    for (const k of ["search", "dashboard 365d", "feed", "tasks today"]) expect(timings[k]).toBeLessThan(BUDGET_MS);
  });

  it("pipeline board caps cards per column but keeps full counts and totals", async () => {
    const res = await timed("pipeline", "/api/v1/pipeline");
    timings["pipeline KB"] = Math.round(res.body.length / 1024);
    const board = res.json() as { columns: { leads: unknown[]; count: number; hasMore: boolean }[] };
    expect(board.columns.every((c) => c.leads.length <= 50)).toBe(true);
    expect(board.columns.some((c) => c.hasMore && c.count > 50)).toBe(true);
    expect(timings.pipeline).toBeLessThan(BUDGET_MS);
    expect(timings["pipeline KB"]).toBeLessThan(500);
  });
});
