import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CalendarItemDTO, LeadHistoryEntryDTO, LookupsDTO, ReportsDTO } from "@crm/shared";
import { seed } from "../scripts/seed";
import { ADMIN, AISHA, RAHUL, setupApp } from "./helpers";

let ctx: Awaited<ReturnType<typeof setupApp>>;
let admin: ReturnType<typeof ctx.as>;
let aisha: ReturnType<typeof ctx.as>;
let rahul: ReturnType<typeof ctx.as>;
let lookups: LookupsDTO;

const leadId = async (name: string) => (await admin.get(`/api/v1/leads?q=${encodeURIComponent(name)}`)).json().items[0].id as string;
const stage = (kind: "won" | "lost") => lookups.stages.find((s) => s.kind === kind)!;
const history = async (id: string) => (await admin.get(`/api/v1/leads/${id}/history`)).json().history as LeadHistoryEntryDTO[];
const report = async (q = "") => (await admin.get(`/api/v1/reports${q}`)).json() as ReportsDTO;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await setupApp();
});
beforeEach(async () => {
  await seed(ctx.handle.db, ctx.storage);
  admin = ctx.as(await ctx.login(ADMIN));
  aisha = ctx.as(await ctx.login(AISHA));
  rahul = ctx.as(await ctx.login(RAHUL));
  lookups = (await admin.get("/api/v1/lookups")).json();
});
afterAll(async () => ctx?.close());

describe("lead change history", () => {
  it("records each edited field with readable before/after values and who changed it", async () => {
    const maya = await leadId("Maya Chen"); // owned by Aisha
    const rahulId = lookups.users.find((u) => u.name === "Rahul Kapoor")!.id;
    const res = await aisha.patch(`/api/v1/leads/${maya}`, { company: "Northstar Labs Ltd", valueCents: 3_000_000, ownerId: rahulId, temperature: "warm" });
    expect(res.statusCode, res.body).toBe(200);

    const [latest] = await history(maya);
    expect(latest).toMatchObject({ kind: "updated", by: { name: "Aisha Rahman" } });
    const changes = latest!.kind === "updated" ? latest!.changes : [];
    expect(changes).toEqual(expect.arrayContaining([
      { field: "company", from: "Northstar Labs", to: "Northstar Labs Ltd" },
      { field: "valueCents", from: "2400000", to: "3000000" },
      { field: "owner", from: "Aisha Rahman", to: "Rahul Kapoor" },
      { field: "temperature", from: "hot", to: "warm" },
    ]));
  });

  it("ignores saves that change nothing, tracks tags as a set, and merges stage moves into one timeline", async () => {
    const maya = await leadId("Maya Chen");
    const before = (await history(maya)).length;
    const lead = (await admin.get(`/api/v1/leads/${maya}`)).json().lead;
    await admin.patch(`/api/v1/leads/${maya}`, { company: lead.company, tagIds: lead.tags.map((t: { id: string }) => t.id) });
    expect((await history(maya)).length).toBe(before);

    const tag = lookups.tags.find((t) => !lead.tags.some((x: { id: string }) => x.id === t.id))!;
    await admin.patch(`/api/v1/leads/${maya}`, { tagIds: [...lead.tags.map((t: { id: string }) => t.id), tag.id] });
    await admin.post(`/api/v1/leads/${maya}/move`, { stageId: stage("won").id });

    const entries = await history(maya);
    expect(entries[0]).toMatchObject({ kind: "stage", to: { kind: "won" } });
    const tagChange = entries.find((e) => e.kind === "updated" && e.changes.some((c) => c.field === "tags"));
    expect(tagChange && tagChange.kind === "updated" && tagChange.changes[0]!.to).toContain(tag.name);
    expect(entries.at(-1)).toMatchObject({ kind: "stage", from: null }); // "Created in …"
  });

  it("records deletions, and members can read history but not see other leads' edits leak into theirs", async () => {
    const owen = await leadId("Owen Wright");
    await rahul.patch(`/api/v1/leads/${owen}`, { phone: "+1 555 0100" }).then((r) => expect(r.statusCode).toBe(403)); // not his lead
    expect((await rahul.get(`/api/v1/leads/${owen}/history`)).statusCode).toBe(200);
    await admin.delete(`/api/v1/leads/${owen}`);
    const rows = await ctx.handle.db.query.leadChanges.findMany();
    expect(rows.some((r) => r.leadId === owen && r.action === "deleted")).toBe(true);
    expect((await admin.get(`/api/v1/leads/${owen}/history`)).statusCode).toBe(404); // deleted leads aren't browsable
  });
});

describe("reports", () => {
  it("summarises wins, losses, reasons, sources, owners, cycle and months", async () => {
    const base = (await report()).summary;
    expect(base.won).toBeGreaterThan(0); // the seed has a recent win
    await aisha.post(`/api/v1/leads/${await leadId("Nora Reed")}/move`, { stageId: stage("lost").id, lostReason: "budget" });
    await aisha.post(`/api/v1/leads/${await leadId("Owen Wright")}/move`, { stageId: stage("lost").id, lostReason: "competitor" });
    await admin.post(`/api/v1/leads/${await leadId("Theo Martin")}/move`, { stageId: stage("lost").id, lostReason: "budget" });

    const r = await report();
    expect(r.summary.won).toBe(base.won);
    expect(r.summary.lost).toBe(base.lost + 3);
    expect(r.summary.winRate).toBeCloseTo(base.won / (base.won + base.lost + 3));
    expect(r.summary.medianCycleDays).not.toBeNull();
    expect(r.lostReasons[0]).toMatchObject({ reason: "budget", count: 2 });
    expect(r.lostReasons.map((x) => x.reason)).toContain("competitor");
    const totalCreated = r.sources.reduce((n, s) => n + s.created, 0);
    expect(totalCreated).toBe(r.summary.created);
    for (const s of r.sources) expect(s.won + s.lost + s.open).toBe(s.created);
    expect(r.owners.reduce((n, o) => n + o.won + o.lost, 0)).toBe(r.summary.won + r.summary.lost);
    expect(r.cycleBuckets.reduce((n, b) => n + b.count, 0)).toBe(r.summary.won);
    expect(r.monthly.reduce((n, m) => n + m.won + m.lost, 0)).toBe(r.summary.won + r.summary.lost);
    expect(r.monthly.length).toBeGreaterThanOrEqual(3); // every month in the range, gaps included
  });

  it("filters by owner, source and dates, and validates the range", async () => {
    const aishaId = lookups.users.find((u) => u.name === "Aisha Rahman")!.id;
    const mine = await report(`?ownerId=${aishaId}`);
    expect(mine.owners.every((o) => o.owner?.id === aishaId)).toBe(true);
    const website = lookups.sources.find((s) => s.name === "Website")!;
    expect((await report(`?sourceId=${website.id}`)).sources.every((s) => s.source?.id === website.id)).toBe(true);

    const longAgo = await report("?from=2020-01-01&to=2020-03-31");
    expect(longAgo.summary).toMatchObject({ created: 0, won: 0, lost: 0, winRate: null, medianCycleDays: null });
    expect(longAgo.range).toMatchObject({ from: "2020-01-01", to: "2020-03-31" });
    expect((await admin.get("/api/v1/reports?from=2026-05-01&to=2026-01-01")).statusCode).toBe(400);
    expect((await admin.get("/api/v1/reports?from=yesterday")).statusCode).toBe(400);
  });

  it("exports closed deals as CSV with formula-safe cells", async () => {
    const base = (await report()).summary;
    const nora = await leadId("Nora Reed");
    await admin.patch(`/api/v1/leads/${nora}`, { company: "=HYPERLINK(\"http://evil\")" });
    await admin.post(`/api/v1/leads/${nora}/move`, { stageId: stage("lost").id, lostReason: "timing", lostNotes: "Next quarter, maybe" });
    const res = await admin.get("/api/v1/reports/deals.csv");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="closed-deals-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = res.body.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Lead,Company,Email,Source,Owner,Outcome,Lost reason,Lost notes,Value,Created,Closed,Days to close");
    const noraLine = lines.find((l) => l.startsWith("Nora Reed"))!;
    expect(noraLine).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(noraLine).toContain("Lost,timing,\"Next quarter, maybe\"");
    expect(lines.length).toBe(1 + base.won + base.lost + 1); // header + earlier closed deals + Nora
  });
});

describe("calendar", () => {
  const window = () => {
    const from = new Date(Date.now() - 20 * 86_400_000);
    const to = new Date(Date.now() + 30 * 86_400_000);
    return `from=${from.toISOString()}&to=${to.toISOString()}`;
  };
  const items = async (as: typeof admin, q = "") => {
    const res = await as.get(`/api/v1/calendar?${window()}${q}`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json().items as CalendarItemDTO[];
  };

  it("brings activities, tasks, follow-ups and expected close dates together", async () => {
    const maya = await leadId("Maya Chen");
    await admin.patch(`/api/v1/leads/${maya}`, { expectedClose: ymd(new Date(Date.now() + 5 * 86_400_000)) });
    const all = await items(admin);
    const kinds = new Set(all.map((i) => i.kind));
    for (const k of ["task", "followup", "call", "close"]) expect(kinds, k).toContain(k);
    expect(all.find((i) => i.kind === "close" && i.lead?.id === maya)).toMatchObject({ allDay: true, at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    // All-day items come first, then by time.
    const firstTimed = all.findIndex((i) => !i.allDay);
    expect(all.slice(firstTimed).every((i) => !i.allDay)).toBe(true);
  });

  it("filters by person and kind, hides closed deals' follow-ups, and limits the range", async () => {
    const aishaId = lookups.users.find((u) => u.name === "Aisha Rahman")!.id;
    expect((await items(admin, `&userId=${aishaId}`)).every((i) => i.person?.id === aishaId)).toBe(true);
    expect((await items(admin, "&kinds=task")).every((i) => i.kind === "task")).toBe(true);

    const followups = (await items(admin, "&kinds=followup")).map((i) => i.lead!.id);
    const lena = await leadId("Lena Rodriguez");
    if (followups.includes(lena)) {
      await admin.post(`/api/v1/leads/${lena}/move`, { stageId: stage("won").id });
      expect((await items(admin, "&kinds=followup")).map((i) => i.lead!.id)).not.toContain(lena);
    }
    expect((await admin.get("/api/v1/calendar?from=2026-01-01T00:00:00Z&to=2026-06-01T00:00:00Z")).statusCode).toBe(400);
    expect((await admin.get("/api/v1/calendar")).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: "GET", url: `/api/v1/calendar?${window()}` })).statusCode).toBe(401);
  });
});
