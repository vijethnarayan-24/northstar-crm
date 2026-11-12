import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DashboardDTO, FeedPageDTO, GoalDTO, LookupsDTO } from "@crm/shared";
import { seed } from "../scripts/seed";
import { ADMIN, AISHA, RAHUL, setupApp } from "./helpers";

let ctx: Awaited<ReturnType<typeof setupApp>>;
let admin: ReturnType<typeof ctx.as>;
let aisha: ReturnType<typeof ctx.as>;
let rahul: ReturnType<typeof ctx.as>;

const dashboard = async (as: typeof admin, q = "") => (await as.get(`/api/v1/dashboard${q}`)).json() as DashboardDTO;
const feed = async (as: typeof admin, q = "") => (await as.get(`/api/v1/feed${q}`)).json() as FeedPageDTO;
const leadId = async (name: string) => (await admin.get(`/api/v1/leads?q=${encodeURIComponent(name)}`)).json().items[0].id as string;

beforeAll(async () => {
  ctx = await setupApp();
});
beforeEach(async () => {
  await seed(ctx.handle.db, ctx.storage);
  admin = ctx.as(await ctx.login(ADMIN));
  aisha = ctx.as(await ctx.login(AISHA));
  rahul = ctx.as(await ctx.login(RAHUL));
});
afterAll(async () => ctx?.close());

describe("dashboard", () => {
  it("computes team KPIs from the seeded data", async () => {
    const d = await dashboard(admin, "?range=30d");
    expect(d.kpis.newLeads).toEqual({ value: 9, previous: 0 });
    expect(d.kpis.hotLeads.value).toBe(4); // Maya, Lena, Nora, Sara
    expect(d.kpis.dealsWon).toEqual({ value: 1, previous: 0 }); // Daniel, 5 days ago
    expect(d.kpis.wonValueCents.value).toBe(960_000);
    expect(d.kpis.openDeals).toBe(8);
    expect(d.kpis.dealsLost.value).toBe(0);
    expect(d.kpis.winRate).toEqual({ value: 1, previous: null }); // 1 won, 0 lost
    // Open deals: 24,000 + 18,500 + 32,000 + 8,000 + 12,400 + 16,000 + 7,500 + 28,000 = $146,400
    expect(d.kpis.pipelineValueCents.value).toBe(14_640_000);
    expect(d.bySource.reduce((n, s) => n + s.count, 0)).toBe(9);
    expect(d.byStage.map((s) => s.stage.name)).toEqual(["New", "Contacted", "In Discussion", "Proposal Sent", "Negotiation", "Won", "Lost"]);
    expect(d.byStage.reduce((n, s) => n + s.count, 0)).toBe(9);
  });

  it("shorter ranges count fewer new leads; the previous period is the window before", async () => {
    const d = await dashboard(admin, "?range=7d");
    // Last 7 days: Nora (1d), Priya (2d), Maya (4d), Lena (6d).
    expect(d.kpis.newLeads.value).toBe(4);
    // Days 7–14: James (8d), Theo (9d), Sara (11d). Owen was created exactly 14 days before the
    // seed ran, so by query time he is just outside the window.
    expect(d.kpis.newLeads.previous).toBe(3);
  });

  it("scope=me only counts the viewer's own leads", async () => {
    const mine = await dashboard(aisha, "?scope=me");
    expect(mine.kpis.newLeads.value).toBe(3); // Maya, Owen, Nora
    expect(mine.byStage.reduce((n, s) => n + s.count, 0)).toBe(3);
  });

  it("moving a deal to Won shows up immediately", async () => {
    const lookups = (await admin.get("/api/v1/lookups")).json() as LookupsDTO;
    const won = lookups.stages.find((s) => s.kind === "won")!;
    await aisha.post(`/api/v1/leads/${await leadId("Maya Chen")}/move`, { stageId: won.id });
    const d = await dashboard(admin);
    expect(d.kpis.dealsWon.value).toBe(2);
    const lost = lookups.stages.find((s) => s.kind === "lost")!;
    await aisha.post(`/api/v1/leads/${await leadId("Nora Reed")}/move`, { stageId: lost.id, lostReason: "budget" });
    const after = await dashboard(admin);
    expect(after.kpis.dealsLost.value).toBe(1);
    expect(after.kpis.winRate.value).toBeCloseTo(2 / 3);
    expect(d.kpis.wonValueCents.value).toBe(960_000 + 2_400_000);
  });

  it("rejects unknown ranges", async () => {
    expect((await admin.get("/api/v1/dashboard?range=2y")).statusCode).toBe(400);
  });
});

describe("activity feed", () => {
  it("lists newest first with actor, lead and payload, and pages with a cursor", async () => {
    const first = await feed(admin, "?limit=3");
    expect(first.events).toHaveLength(3);
    expect(first.events[0]!).toMatchObject({ type: "lead.stage_changed", actor: { name: "Rahul Kapoor" }, lead: { fullName: "James Wilson" }, payload: { to: "Proposal Sent" } });
    expect(first.nextBefore).not.toBeNull();
    const second = await feed(admin, `?limit=3&before=${encodeURIComponent(first.nextBefore!)}`);
    expect(second.events).toHaveLength(2);
    expect(second.nextBefore).toBeNull();
    const ids = [...first.events, ...second.events].map((e) => e.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("records new actions and filters by type, person and lead", async () => {
    const maya = await leadId("Maya Chen");
    await rahul.post(`/api/v1/leads/${maya}/activities`, { type: "call", title: "Check-in" });
    const latest = await feed(admin, "?limit=1");
    expect(latest.events[0]).toMatchObject({ type: "activity.logged", actor: { name: "Rahul Kapoor" }, lead: { id: maya }, payload: { activityType: "call", title: "Check-in" } });
    const rahulOnly = await feed(admin, `?actorId=${latest.events[0]!.actor!.id}`);
    expect(rahulOnly.events.every((e) => e.actor?.name === "Rahul Kapoor")).toBe(true);
    const onMaya = await feed(admin, `?leadId=${maya}`);
    expect(onMaya.events.every((e) => e.lead?.id === maya)).toBe(true);
    const created = await feed(admin, "?type=lead.created");
    expect(created.events.every((e) => e.type === "lead.created")).toBe(true);
  });

  it("names the assignee for assignment events and flags deleted leads", async () => {
    const lookups = (await admin.get("/api/v1/lookups")).json() as LookupsDTO;
    const rahulId = lookups.users.find((u) => u.name === "Rahul Kapoor")!.id;
    const owen = await leadId("Owen Wright");
    await aisha.patch(`/api/v1/leads/${owen}`, { ownerId: rahulId });
    const assigned = (await feed(admin, "?type=lead.assigned")).events[0]!;
    expect(assigned.subjectUser?.name).toBe("Rahul Kapoor");
    await admin.delete(`/api/v1/leads/${owen}`);
    expect((await feed(admin, "?type=lead.assigned")).events[0]!.lead).toMatchObject({ fullName: "Owen Wright", deleted: true });
  });
});

describe("monthly goal", () => {
  it("shows this month's target and won value; only admins can change it", async () => {
    const g = (await aisha.get("/api/v1/goal")).json().goal as GoalDTO;
    expect(g.targetCents).toBe(10_000_000);
    expect(g.wonCents).toBeGreaterThanOrEqual(0);
    expect((await aisha.put("/api/v1/goal", { month: g.month, targetCents: 1 })).statusCode).toBe(403);
    const updated = (await admin.put("/api/v1/goal", { month: g.month, targetCents: 15_000_000 })).json().goal as GoalDTO;
    expect(updated.targetCents).toBe(15_000_000);
    const cleared = (await admin.put("/api/v1/goal", { month: g.month, targetCents: null })).json().goal as GoalDTO;
    expect(cleared.targetCents).toBeNull();
    expect((await admin.put("/api/v1/goal", { month: "2026-13", targetCents: 1 })).statusCode).toBe(400);
  });
});
