import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LookupsDTO, PipelineDTO, SourceAdminDTO, StageAdminDTO, TagAdminDTO } from "@crm/shared";
import { seed } from "../scripts/seed";
import { ADMIN, AISHA, setupApp } from "./helpers";

let ctx: Awaited<ReturnType<typeof setupApp>>;
let admin: ReturnType<typeof ctx.as>;
let aisha: ReturnType<typeof ctx.as>;

const stagesNow = async () => (await admin.get("/api/v1/settings/stages")).json().stages as StageAdminDTO[];
const sourcesNow = async () => (await admin.get("/api/v1/settings/sources")).json().sources as SourceAdminDTO[];
const tagsNow = async () => (await admin.get("/api/v1/settings/tags")).json().tags as TagAdminDTO[];
const board = async (q = "") => (await admin.get(`/api/v1/pipeline${q}`)).json() as PipelineDTO;
const leadId = async (name: string) => (await admin.get(`/api/v1/leads?q=${encodeURIComponent(name)}`)).json().items[0].id as string;

beforeAll(async () => {
  ctx = await setupApp();
});
beforeEach(async () => {
  await seed(ctx.handle.db, ctx.storage);
  admin = ctx.as(await ctx.login(ADMIN));
  aisha = ctx.as(await ctx.login(AISHA));
});
afterAll(async () => ctx?.close());

describe("pipeline board", () => {
  it("returns every active stage as a column with counts and totals", async () => {
    const b = await board();
    expect(b.columns.map((c) => c.stage.name)).toEqual(["New", "Contacted", "In Discussion", "Proposal Sent", "Negotiation", "Won", "Lost"]);
    const proposal = b.columns.find((c) => c.stage.name === "Proposal Sent")!;
    expect(proposal.count).toBe(2);
    expect(proposal.totalCents).toBe(1_850_000 + 2_800_000);
    expect(b.columns.reduce((n, c) => n + c.count, 0)).toBe(9);
  });

  it("orders cards by position and reflects moves", async () => {
    const nora = await leadId("Nora Reed");
    const stageNew = (await board()).columns[0]!.stage.id;
    await admin.post(`/api/v1/leads/${nora}/move`, { stageId: stageNew, position: 0 });
    expect((await board()).columns[0]!.leads.map((l) => l.fullName)).toEqual(["Nora Reed", "Priya Shah"]);
  });

  it("filters by owner and hides deals closed long ago", async () => {
    const lookups = (await admin.get("/api/v1/lookups")).json() as LookupsDTO;
    const mia = lookups.users.find((u) => u.name === "Mia Kim")!.id;
    const mine = await board(`?ownerId=${mia}`);
    expect(mine.columns.flatMap((c) => c.leads).every((l) => l.owner?.id === mia)).toBe(true);
    // Daniel Kim was won 5 days ago.
    expect((await board("?closedWithinDays=7")).columns.find((c) => c.stage.kind === "won")!.count).toBe(1);
    expect((await board("?closedWithinDays=3")).columns.find((c) => c.stage.kind === "won")!.count).toBe(0);
  });
});

describe("lead sources", () => {
  it("members can read but not change", async () => {
    expect((await aisha.get("/api/v1/settings/sources")).statusCode).toBe(200);
    expect((await aisha.post("/api/v1/sources", { name: "Dribbble" })).statusCode).toBe(403);
  });

  it("creates, renames with case-insensitive uniqueness, reorders", async () => {
    const created = await admin.post("/api/v1/sources", { name: "Dribbble", color: "red" });
    expect(created.statusCode).toBe(201);
    expect((await admin.post("/api/v1/sources", { name: "dribbble" })).json().issues.name).toBeDefined();
    const id = created.json().source.id;
    expect((await admin.patch(`/api/v1/sources/${id}`, { name: "WEBSITE" })).statusCode).toBe(400);
    const ids = (await sourcesNow()).map((s) => s.id).reverse();
    const res = await admin.put("/api/v1/sources/order", { ids });
    expect(res.statusCode).toBe(204);
    expect((await sourcesNow()).map((s) => s.id)).toEqual(ids);
  });

  it("only deletes unused sources; used ones are archived and hidden from lookups", async () => {
    const website = (await sourcesNow()).find((s) => s.name === "Website")!;
    expect(website.leadCount).toBe(3);
    const del = await admin.delete(`/api/v1/sources/${website.id}`);
    expect(del.statusCode).toBe(409);
    expect(del.json().error).toBe("in_use");

    await admin.patch(`/api/v1/sources/${website.id}`, { archived: true });
    const lookups = (await admin.get("/api/v1/lookups")).json() as LookupsDTO;
    expect(lookups.sources.map((s) => s.name)).not.toContain("Website");
    // Existing leads keep their (archived) source.
    const maya = (await admin.get(`/api/v1/leads/${await leadId("Maya Chen")}`)).json().lead;
    expect(maya.source.name).toBe("Website");
    // An archived name can be reused, and restoring then collides.
    await admin.post("/api/v1/sources", { name: "Website" });
    expect((await admin.patch(`/api/v1/sources/${website.id}`, { archived: false })).statusCode).toBe(400);

    const other = (await sourcesNow()).find((s) => s.name === "Other")!;
    expect((await admin.delete(`/api/v1/sources/${other.id}`)).statusCode).toBe(204);
  });
});

describe("pipeline stages", () => {
  it("adds new stages before Won/Lost and reorders open stages only", async () => {
    const created = await admin.post("/api/v1/stages", { name: "Qualified", color: "blue" });
    expect(created.statusCode).toBe(201);
    let names = (await stagesNow()).map((s) => s.name);
    expect(names.slice(-3)).toEqual(["Qualified", "Won", "Lost"]);

    const open = (await stagesNow()).filter((s) => s.kind === "open");
    const reversed = open.map((s) => s.id).reverse();
    const ok = await admin.put("/api/v1/stages/order", { ids: reversed });
    expect(ok.statusCode).toBe(204);
    names = (await stagesNow()).map((s) => s.name);
    expect(names).toEqual(["Qualified", "Negotiation", "Proposal Sent", "In Discussion", "Contacted", "New", "Won", "Lost"]);

    const won = (await stagesNow()).find((s) => s.kind === "won")!;
    const bad = await admin.put("/api/v1/stages/order", { ids: [won.id, ...reversed] });
    expect(bad.statusCode).toBe(400);
  });

  it("removing a stage moves its leads (with history) and archives it", async () => {
    const stages = await stagesNow();
    const contacted = stages.find((s) => s.name === "Contacted")!;
    const newStage = stages.find((s) => s.name === "New")!;
    expect(contacted.leadCount).toBe(2);

    const missing = await admin.post(`/api/v1/stages/${contacted.id}/remove`, {});
    expect(missing.json().issues.moveToStageId).toBeDefined();
    const toWon = await admin.post(`/api/v1/stages/${contacted.id}/remove`, { moveToStageId: stages.find((s) => s.kind === "won")!.id });
    expect(toWon.statusCode).toBe(400);

    expect((await admin.post(`/api/v1/stages/${contacted.id}/remove`, { moveToStageId: newStage.id })).statusCode).toBe(204);
    const after = await stagesNow();
    expect(after.map((s) => s.name)).not.toContain("Contacted");
    expect(after.find((s) => s.name === "New")!.leadCount).toBe(4);

    const owen = await leadId("Owen Wright");
    const history = (await admin.get(`/api/v1/leads/${owen}/stage-history`)).json().history;
    expect(history[0]).toMatchObject({ from: { name: "Contacted" }, to: { name: "New" } });
    // Can't move a lead into the archived stage any more.
    expect((await admin.post(`/api/v1/leads/${owen}/move`, { stageId: contacted.id })).json().issues.stageId).toBeDefined();
  });

  it("protects Won, Lost and the last open stage", async () => {
    const stages = await stagesNow();
    const won = stages.find((s) => s.kind === "won")!;
    expect((await admin.post(`/api/v1/stages/${won.id}/remove`, {})).json().error).toBe("required_stage");
    // Remove all but one open stage.
    const open = stages.filter((s) => s.kind === "open");
    const keep = open[0]!;
    for (const s of open.slice(1)) {
      expect((await admin.post(`/api/v1/stages/${s.id}/remove`, { moveToStageId: keep.id })).statusCode).toBe(204);
    }
    expect((await admin.post(`/api/v1/stages/${keep.id}/remove`, {})).json().error).toBe("last_open_stage");
  });
});

describe("tags", () => {
  it("renames, merges without duplicate links, and deletes", async () => {
    let tags = await tagsNow();
    const high = tags.find((t) => t.name === "High-value")!;
    const urgent = tags.find((t) => t.name === "Urgent")!;
    const saas = tags.find((t) => t.name === "SaaS")!;
    expect(high.leadCount).toBe(2);

    expect((await admin.patch(`/api/v1/tags/${urgent.id}`, { name: "high-VALUE" })).statusCode).toBe(400);
    expect((await admin.patch(`/api/v1/tags/${urgent.id}`, { name: "Hot deal", color: "red" })).json().tag.name).toBe("Hot deal");

    // Maya has both SaaS and High-value: merging SaaS into High-value must not duplicate.
    expect((await admin.post(`/api/v1/tags/${saas.id}/merge`, { intoId: high.id })).statusCode).toBe(204);
    tags = await tagsNow();
    expect(tags.find((t) => t.name === "SaaS")).toBeUndefined();
    expect(tags.find((t) => t.name === "High-value")!.leadCount).toBe(2);

    expect((await admin.delete(`/api/v1/tags/${urgent.id}`)).statusCode).toBe(204);
    expect((await aisha.delete(`/api/v1/tags/${high.id}`)).statusCode).toBe(403);
  });
});

describe("workspace", () => {
  it("admins set name and a valid time zone", async () => {
    expect((await aisha.patch("/api/v1/workspace", { timezone: "Asia/Kolkata" })).statusCode).toBe(403);
    expect((await admin.patch("/api/v1/workspace", { timezone: "Mars/Olympus" })).statusCode).toBe(400);
    const ok = await admin.patch("/api/v1/workspace", { name: "Northstar Agency", timezone: "Asia/Kolkata" });
    expect(ok.json().workspace).toEqual({ name: "Northstar Agency", timezone: "Asia/Kolkata", currency: "USD" });
    expect((await aisha.get("/api/v1/workspace")).json().workspace.timezone).toBe("Asia/Kolkata");
  });
});

describe("review fixes", () => {
  it("a lead whose owner was deactivated can still be edited", async () => {
    const lookups = (await admin.get("/api/v1/lookups")).json() as LookupsDTO;
    const mia = lookups.users.find((u) => u.name === "Mia Kim")!;
    await admin.patch(`/api/v1/users/${mia.id}`, { active: false });
    const lena = await leadId("Lena Rodriguez");
    const res = await admin.patch(`/api/v1/leads/${lena}`, { ownerId: mia.id, temperature: "warm" });
    expect(res.statusCode, res.body).toBe(200);
    // Assigning a *new* deactivated owner is still rejected.
    const maya = await leadId("Maya Chen");
    expect((await admin.patch(`/api/v1/leads/${maya}`, { ownerId: mia.id })).json().issues.ownerId).toBeDefined();
  });

  it("admins can issue a reset link for a member, which works once", async () => {
    const aishaId = ((await admin.get("/api/v1/lookups")).json() as LookupsDTO).users.find((u) => u.name === "Aisha Rahman")!.id;
    expect((await aisha.post(`/api/v1/users/${aishaId}/reset-link`)).statusCode).toBe(403);
    const link = await admin.post(`/api/v1/users/${aishaId}/reset-link`);
    expect(link.statusCode).toBe(200);
    const token = link.json().resetUrl.split("/reset/")[1];
    expect((await ctx.app.inject({ method: "POST", url: "/api/v1/auth/reset", payload: { token, password: "a-new-password-1" } })).statusCode).toBe(204);
    await ctx.login(AISHA, "a-new-password-1");
  });
});
