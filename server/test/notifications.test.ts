import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LookupsDTO, NotificationPageDTO, NotificationPrefsDTO, SearchResultsDTO } from "@crm/shared";
import { schema } from "../src/db/client";
import { runJobs } from "../src/jobs";
import { seed } from "../scripts/seed";
import { ADMIN, AISHA, RAHUL, setupApp } from "./helpers";

let ctx: Awaited<ReturnType<typeof setupApp>>;
let admin: ReturnType<typeof ctx.as>;
let aisha: ReturnType<typeof ctx.as>;
let rahul: ReturnType<typeof ctx.as>;
let lookups: LookupsDTO;

const user = (name: string) => lookups.users.find((u) => u.name.startsWith(name))!;
const leadId = async (name: string) => (await admin.get(`/api/v1/leads?q=${encodeURIComponent(name)}`)).json().items[0].id as string;
const inbox = async (as: typeof admin, q = "") => (await as.get(`/api/v1/notifications${q}`)).json() as NotificationPageDTO;

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

describe("search", () => {
  it("finds leads by name, company and email, plus tasks and documents", async () => {
    const byName = (await rahul.get("/api/v1/search?q=maya")).json() as SearchResultsDTO;
    expect(byName.leads[0]!.fullName).toBe("Maya Chen");
    expect(byName.tasks.map((t) => t.title)).toContain("Discovery call with Maya Chen");
    expect(((await rahul.get("/api/v1/search?q=flourish")).json() as SearchResultsDTO).leads[0]!.fullName).toBe("Lena Rodriguez");
    expect(((await rahul.get("/api/v1/search?q=northstarlabs.io")).json() as SearchResultsDTO).leads[0]!.fullName).toBe("Maya Chen");
    expect(((await rahul.get("/api/v1/search?q=nda")).json() as SearchResultsDTO).documents[0]!.filename).toBe("Mutual_NDA.pdf");
  });

  it("needs 2+ characters, treats % literally, and hides deleted leads", async () => {
    expect((await rahul.get("/api/v1/search?q=m")).statusCode).toBe(400);
    expect(((await rahul.get("/api/v1/search?q=%25%25")).json() as SearchResultsDTO).leads).toHaveLength(0);
    await aisha.delete(`/api/v1/leads/${await leadId("Owen Wright")}`);
    expect(((await rahul.get("/api/v1/search?q=owen")).json() as SearchResultsDTO).leads).toHaveLength(0);
  });
});

describe("notifications", () => {
  it("assigning a lead notifies the new owner, not the person who did it", async () => {
    await aisha.patch(`/api/v1/leads/${await leadId("Owen Wright")}`, { ownerId: user("Rahul").id });
    const r = await inbox(rahul);
    expect(r.unreadCount).toBe(1);
    expect(r.items[0]!.event).toMatchObject({ type: "lead.assigned", actor: { name: "Aisha Rahman" }, lead: { fullName: "Owen Wright" } });
    expect((await inbox(aisha)).unreadCount).toBe(0);
  });

  it("activity, stage changes and tasks on my lead reach me; my own actions don't", async () => {
    const maya = await leadId("Maya Chen"); // owner Aisha
    await rahul.post(`/api/v1/leads/${maya}/activities`, { type: "call", title: "Quick sync", nextStep: "Send deck", nextStepDueAt: new Date(Date.now() + 86_400_000).toISOString() });
    const types = (await inbox(aisha)).items.map((n) => n.event.type).sort();
    expect(types).toEqual(["activity.logged", "task.created"]);
    await aisha.post(`/api/v1/leads/${maya}/activities`, { type: "note", title: "My own note" });
    expect((await inbox(aisha)).unreadCount).toBe(2);
  });

  it("marks one or all as read", async () => {
    const maya = await leadId("Maya Chen");
    await rahul.post(`/api/v1/leads/${maya}/activities`, { type: "call", title: "A" });
    await rahul.post(`/api/v1/leads/${maya}/activities`, { type: "call", title: "B" });
    const box = await inbox(aisha);
    expect(box.unreadCount).toBe(2);
    expect((await aisha.post("/api/v1/notifications/read", { ids: [box.items[0]!.id] })).json().unreadCount).toBe(1);
    expect((await aisha.post("/api/v1/notifications/read", {})).json().unreadCount).toBe(0);
    expect((await inbox(aisha, "?unread=1")).items).toHaveLength(0);
    expect((await inbox(aisha)).items).toHaveLength(2);
  });

  it("respects per-category preferences", async () => {
    const prefs = (await aisha.put("/api/v1/me/notification-prefs", { key: "my_leads", inApp: false })).json() as NotificationPrefsDTO;
    expect(prefs.categories.find((c) => c.key === "my_leads")!.inApp).toBe(false);
    await rahul.post(`/api/v1/leads/${await leadId("Maya Chen")}/activities`, { type: "call", title: "Muted" });
    expect((await inbox(aisha)).unreadCount).toBe(0);
    await aisha.put("/api/v1/me/notification-prefs", { key: "my_leads", inApp: true });
    await rahul.post(`/api/v1/leads/${await leadId("Maya Chen")}/activities`, { type: "call", title: "Heard" });
    expect((await inbox(aisha)).unreadCount).toBe(1);
  });

  it("deactivated people get nothing; I only ever see my own notifications", async () => {
    await admin.patch(`/api/v1/users/${user("Aisha").id}`, { active: false });
    await rahul.post(`/api/v1/leads/${await leadId("Maya Chen")}/activities`, { type: "call", title: "Nobody home" });
    const rows = await ctx.handle.db.select().from(schema.notifications).where(eq(schema.notifications.userId, user("Aisha").id));
    expect(rows).toHaveLength(0);
    expect((await inbox(rahul)).items.every((n) => n.event.actor?.name !== "Rahul Kapoor")).toBe(true);
  });
});

describe("background jobs", () => {
  it("sends today's follow-up and task reminders once, and cleans up expired sessions", async () => {
    // Make sure something is due later today in any time zone the tests run in.
    const soon = new Date(Date.now() + 5 * 60_000);
    const maya = await leadId("Maya Chen");
    await aisha.patch(`/api/v1/leads/${maya}`, { nextFollowupAt: soon.toISOString() });
    await rahul.post("/api/v1/tasks", { title: "Due very soon", assigneeId: user("Rahul").id, dueAt: soon.toISOString() });
    await ctx.handle.db.insert(schema.sessions).values({ id: "expired-session-hash", userId: user("Rahul").id, expiresAt: new Date(Date.now() - 1000) });

    const first = await runJobs(ctx.handle.db);
    expect(first.followups).toBeGreaterThanOrEqual(1);
    expect(first.taskReminders).toBeGreaterThanOrEqual(1);
    expect(first.expiredSessions).toBe(1);
    const second = await runJobs(ctx.handle.db);
    expect(second).toMatchObject({ followups: 0, taskReminders: 0, expiredSessions: 0 });

    expect((await inbox(aisha)).items.some((n) => n.event.type === "followup.due" && n.event.lead?.fullName === "Maya Chen")).toBe(true);
    expect((await inbox(rahul)).items.some((n) => n.event.type === "task.due" && n.event.payload.title === "Due very soon")).toBe(true);
  });
});
