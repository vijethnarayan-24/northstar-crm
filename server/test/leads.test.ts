import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LeadDetailDTO, LeadListItemDTO, LookupsDTO, Paginated } from "@crm/shared";
import { seed } from "../scripts/seed";
import { ADMIN, AISHA, RAHUL, setupApp } from "./helpers";

let ctx: Awaited<ReturnType<typeof setupApp>>;
let admin: ReturnType<typeof ctx.as>;
let aisha: ReturnType<typeof ctx.as>;
let rahul: ReturnType<typeof ctx.as>;
let lookups: LookupsDTO;

const list = async (query = "") => (await admin.get(`/api/v1/leads${query}`)).json() as Paginated<LeadListItemDTO>;
const stage = (name: string) => lookups.stages.find((s) => s.name === name)!;
const user = (name: string) => lookups.users.find((u) => u.name.startsWith(name))!;
const leadByName = async (name: string) => (await list(`?q=${encodeURIComponent(name)}`)).items[0]!;

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

describe("lookups", () => {
  it("returns sources, stages in order, tags, active users and lead types", () => {
    expect(lookups.stages.map((s) => s.name)).toEqual(["New", "Contacted", "In Discussion", "Proposal Sent", "Negotiation", "Won", "Lost"]);
    expect(lookups.sources.map((s) => s.name)).toContain("Website");
    expect(lookups.users).toHaveLength(4);
    expect(lookups.leadTypes).toContain("Design");
  });

  it("creates tags inline and reuses an existing name", async () => {
    const created = await aisha.post("/api/v1/tags", { name: "Fintech", color: "blue" });
    expect(created.statusCode).toBe(201);
    const again = await aisha.post("/api/v1/tags", { name: "fintech" });
    expect(again.statusCode).toBe(200);
    expect(again.json().tag.id).toBe(created.json().tag.id);
  });
});

describe("list", () => {
  it("requires a session", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/v1/leads" })).statusCode).toBe(401);
  });

  it("pages with a real total", async () => {
    const page1 = await list("?pageSize=4&page=1");
    const page3 = await list("?pageSize=4&page=3");
    expect(page1.total).toBe(9);
    expect(page1.items).toHaveLength(4);
    expect(page3.items).toHaveLength(1);
  });

  it("searches name, company and email; treats % literally", async () => {
    expect((await list("?q=northstar")).items.map((l) => l.fullName)).toEqual(["Maya Chen"]);
    expect((await list("?q=arcstone")).items[0]!.fullName).toBe("James Wilson");
    expect((await list("?q=%25")).total).toBe(0);
  });

  it("filters by temperature, source, stage, owner and tag (repeat or comma-separated)", async () => {
    const hot = await list("?temperature=hot");
    expect(hot.items.every((l) => l.temperature === "hot")).toBe(true);
    const website = lookups.sources.find((s) => s.name === "Website")!.id;
    expect((await list(`?sourceId=${website}`)).items.map((l) => l.fullName).sort()).toEqual(["Daniel Kim", "Maya Chen", "Nora Reed"]);
    const ids = `${stage("New").id},${stage("Won").id}`;
    expect((await list(`?stageId=${ids}`)).total).toBe(3);
    expect((await list(`?ownerId=${user("Mia").id}`)).items.every((l) => l.owner?.name === "Mia Kim")).toBe(true);
    const highValue = lookups.tags.find((t) => t.name === "High-value")!.id;
    expect((await list(`?tagId=${highValue}`)).items.map((l) => l.fullName).sort()).toEqual(["Lena Rodriguez", "Maya Chen"]);
  });

  it("finds overdue follow-ups on open deals only", async () => {
    // Some seeded follow-ups are "today at 2:30 PM", so the exact set depends on the clock.
    const overdue = await list("?followup=overdue&pageSize=50");
    const names = overdue.items.map((l) => l.fullName);
    expect(names).toEqual(expect.arrayContaining(["Lena Rodriguez", "Sara Ahmed"]));
    expect(names).not.toContain("Daniel Kim"); // won deal
    expect(overdue.items.every((l) => l.stage.kind === "open" && new Date(l.nextFollowupAt!) < new Date())).toBe(true);
    const upcoming = await list("?followup=upcoming&pageSize=50");
    expect(upcoming.items.every((l) => new Date(l.nextFollowupAt!) >= new Date())).toBe(true);
    expect(overdue.total + upcoming.total).toBe(8); // every open lead with a follow-up date
  });

  it("sorts with nulls last", async () => {
    const byValue = await list("?sort=valueCents&dir=desc&pageSize=3");
    expect(byValue.items.map((l) => l.valueCents)).toEqual([3_200_000, 2_800_000, 2_400_000]);
    const byFollowup = await list("?sort=nextFollowupAt&dir=asc&pageSize=50");
    expect(byFollowup.items.at(-1)!.nextFollowupAt).toBeNull();
  });

  it("rejects bad query values", async () => {
    expect((await admin.get("/api/v1/leads?temperature=boiling")).statusCode).toBe(400);
    expect((await admin.get("/api/v1/leads?sort=password")).statusCode).toBe(400);
  });
});

describe("create", () => {
  it("validates required fields and emails", async () => {
    const res = await aisha.post("/api/v1/leads", { fullName: " ", email: "nope" });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().issues)).toEqual(expect.arrayContaining(["fullName", "email"]));
  });

  it("creates in the first open stage with tags, pinned note, history and feed event", async () => {
    const tag = lookups.tags.find((t) => t.name === "Urgent")!;
    const res = await aisha.post("/api/v1/leads", {
      fullName: "Jordan Lee", company: "Brightline", email: "Jordan@Brightline.io", phone: "", temperature: "hot",
      valueCents: 1_500_000, ownerId: user("Rahul").id, tagIds: [tag.id], pinnedNote: "Met at the conference",
      nextFollowupAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(res.statusCode, res.body).toBe(201);
    const lead = res.json().lead as LeadDetailDTO;
    expect(lead).toMatchObject({ fullName: "Jordan Lee", email: "jordan@brightline.io", phone: null, temperature: "hot", valueCents: 1_500_000 });
    expect(lead.stage.name).toBe("New");
    expect(lead.position).toBe(2); // New already has Priya (0) and Nora (1)
    expect(lead.tags.map((t) => t.name)).toEqual(["Urgent"]);
    expect(lead.pinnedBy?.name).toBe("Aisha Rahman");
    expect(lead.owner?.name).toBe("Rahul Kapoor");
    const history = (await aisha.get(`/api/v1/leads/${lead.id}/stage-history`)).json().history;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: null, to: { name: "New" } });
  });

  it("warns about duplicate emails unless told to continue", async () => {
    const dup = await aisha.post("/api/v1/leads", { fullName: "Maya Again", email: "MAYA@northstarlabs.io" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: "duplicate_email", lead: { fullName: "Maya Chen" } });
    const ok = await aisha.post("/api/v1/leads", { fullName: "Maya Again", email: "maya@northstarlabs.io", allowDuplicate: true });
    expect(ok.statusCode).toBe(201);
  });

  it("rejects unknown owners/tags and creating straight into Lost", async () => {
    const bad = await aisha.post("/api/v1/leads", { fullName: "X", ownerId: crypto.randomUUID(), tagIds: [crypto.randomUUID()] });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().issues).sort()).toEqual(["ownerId", "tagIds"]);
    const lost = await aisha.post("/api/v1/leads", { fullName: "X", stageId: stage("Lost").id });
    expect(lost.json().issues.stageId).toBeDefined();
  });
});

describe("read, update, delete", () => {
  it("returns detail with permissions and counts", async () => {
    const maya = await leadByName("Maya Chen");
    const asOwner = (await aisha.get(`/api/v1/leads/${maya.id}`)).json().lead as LeadDetailDTO;
    const asOther = (await rahul.get(`/api/v1/leads/${maya.id}`)).json().lead as LeadDetailDTO;
    expect(asOwner).toMatchObject({ jobTitle: "Head of Product", canEdit: true, canDelete: true, counts: { openTasks: 5, documents: 3 } });
    expect(asOther).toMatchObject({ canEdit: false, canDelete: false });
    expect((await admin.get(`/api/v1/leads/${crypto.randomUUID()}`)).statusCode).toBe(404);
  });

  it("members can't edit leads owned by someone else; admins can", async () => {
    const maya = await leadByName("Maya Chen");
    expect((await rahul.patch(`/api/v1/leads/${maya.id}`, { temperature: "cold" })).statusCode).toBe(403);
    expect((await admin.patch(`/api/v1/leads/${maya.id}`, { temperature: "cold" })).json().lead.temperature).toBe("cold");
  });

  it("updates fields, replaces tags, tracks who pinned the note, and clears blanks", async () => {
    const maya = await leadByName("Maya Chen");
    const tag = lookups.tags.find((t) => t.name === "Startup")!;
    const res = await aisha.patch(`/api/v1/leads/${maya.id}`, { location: "", tagIds: [tag.id], pinnedNote: "Updated context", valueCents: 2_600_000 });
    expect(res.statusCode, res.body).toBe(200);
    const lead = res.json().lead as LeadDetailDTO;
    expect(lead).toMatchObject({ location: null, valueCents: 2_600_000, pinnedNote: "Updated context", pinnedBy: { name: "Aisha Rahman" } });
    expect(lead.tags.map((t) => t.name)).toEqual(["Startup"]);
  });

  it("ignores stage changes through PATCH (they go through /move)", async () => {
    const maya = await leadByName("Maya Chen");
    const res = await aisha.patch(`/api/v1/leads/${maya.id}`, { stageId: stage("Won").id });
    expect(res.json().lead.stage.name).toBe("Negotiation");
  });

  it("soft-deletes: gone from lists and detail", async () => {
    const owen = await leadByName("Owen Wright");
    expect((await rahul.delete(`/api/v1/leads/${owen.id}`)).statusCode).toBe(403);
    expect((await aisha.delete(`/api/v1/leads/${owen.id}`)).statusCode).toBe(204);
    expect((await admin.get(`/api/v1/leads/${owen.id}`)).statusCode).toBe(404);
    expect((await list()).total).toBe(8);
  });
});

describe("move", () => {
  it("records history and feed, sets won, and requires a reason for lost", async () => {
    const maya = await leadByName("Maya Chen");
    const won = await aisha.post(`/api/v1/leads/${maya.id}/move`, { stageId: stage("Won").id });
    expect(won.json().lead).toMatchObject({ stage: { name: "Won" } });
    expect(won.json().lead.wonAt).not.toBeNull();

    const noReason = await aisha.post(`/api/v1/leads/${maya.id}/move`, { stageId: stage("Lost").id });
    expect(noReason.json().issues.lostReason).toBeDefined();

    const lost = await aisha.post(`/api/v1/leads/${maya.id}/move`, { stageId: stage("Lost").id, lostReason: "budget", lostNotes: "Paused until Q3" });
    expect(lost.json().lead).toMatchObject({ wonAt: null, lostReason: "budget", lostNotes: "Paused until Q3", stage: { name: "Lost" } });

    const history = (await aisha.get(`/api/v1/leads/${maya.id}/stage-history`)).json().history;
    expect(history[0]).toMatchObject({ from: { name: "Won" }, to: { name: "Lost" }, changedBy: { name: "Aisha Rahman" } });
  });

  it("reorders within a column", async () => {
    const nora = await leadByName("Nora Reed");
    await admin.post(`/api/v1/leads/${nora.id}/move`, { stageId: stage("New").id, position: 0 });
    const column = await list(`?stageId=${stage("New").id}`);
    const ordered = [...column.items].sort((a, b) => a.position - b.position).map((l) => l.fullName);
    expect(ordered).toEqual(["Nora Reed", "Priya Shah"]);
  });
});

describe("detail tabs", () => {
  it("lists activities, tasks, documents for a lead", async () => {
    const maya = await leadByName("Maya Chen");
    const acts = (await rahul.get(`/api/v1/leads/${maya.id}/activities`)).json().activities;
    expect(acts.map((a: { type: string }) => a.type)).toEqual(["email", "call", "note"]);
    const tasks = (await rahul.get(`/api/v1/leads/${maya.id}/tasks`)).json().tasks;
    expect(tasks).toHaveLength(5);
    const docs = (await rahul.get(`/api/v1/leads/${maya.id}/documents`)).json().documents;
    expect(docs[0].filename).toBe("Northstar_Product_Proposal_v2.pdf");
  });
});
