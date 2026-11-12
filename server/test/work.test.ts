import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ActivityDTO, LeadDetailDTO, LookupsDTO, TaskDTO, TaskStatsDTO } from "@crm/shared";
import { seed } from "../scripts/seed";
import { ADMIN, AISHA, RAHUL, setupApp } from "./helpers";

let ctx: Awaited<ReturnType<typeof setupApp>>;
let admin: ReturnType<typeof ctx.as>;
let aisha: ReturnType<typeof ctx.as>;
let rahul: ReturnType<typeof ctx.as>;
let lookups: LookupsDTO;

const HOUR = 3_600_000;
const user = (name: string) => lookups.users.find((u) => u.name.startsWith(name))!;
const leadId = async (name: string) => (await admin.get(`/api/v1/leads?q=${encodeURIComponent(name)}`)).json().items[0].id as string;
const tasksFor = async (as: typeof admin, query: string) => (await as.get(`/api/v1/tasks${query}`)).json().tasks as TaskDTO[];
const stats = async (as: typeof admin, query = "") => (await as.get(`/api/v1/tasks/stats${query}`)).json().stats as TaskStatsDTO;

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

describe("activities", () => {
  it("anyone can log activity; it updates last activity and appears first in the timeline", async () => {
    const maya = await leadId("Maya Chen"); // owned by Aisha
    const res = await rahul.post(`/api/v1/leads/${maya}/activities`, { type: "call", title: "Quick check-in", body: "", nextStep: "" });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().activity).toMatchObject({ type: "call", title: "Quick check-in", body: null, nextStep: null, author: { name: "Rahul Kapoor" }, canEdit: true });
    expect(res.json().task).toBeNull();

    const timeline = (await admin.get(`/api/v1/leads/${maya}/activities`)).json().activities as ActivityDTO[];
    expect(timeline[0]!.title).toBe("Quick check-in");
    const lead = (await admin.get(`/api/v1/leads/${maya}`)).json().lead as LeadDetailDTO;
    expect(Date.now() - new Date(lead.lastActivityAt!).getTime()).toBeLessThan(60_000);
  });

  it("a next step with a due date creates a task for the lead owner and sets the follow-up", async () => {
    const maya = await leadId("Maya Chen");
    const due = new Date(Date.now() + 3 * 24 * HOUR).toISOString();
    const res = await rahul.post(`/api/v1/leads/${maya}/activities`, { type: "email", title: "Sent pricing", nextStep: "Call about pricing", nextStepDueAt: due });
    expect(res.json().task).toMatchObject({ title: "Call about pricing", assignee: { name: "Aisha Rahman" }, lead: { fullName: "Maya Chen" }, createdBy: { name: "Rahul Kapoor" } });
    const lead = (await admin.get(`/api/v1/leads/${maya}`)).json().lead as LeadDetailDTO;
    expect(lead.nextFollowupAt).toBe(due);
  });

  it("an unowned lead's next step goes to whoever logged it", async () => {
    const created = (await rahul.post("/api/v1/leads", { fullName: "No Owner", ownerId: null })).json().lead;
    const res = await rahul.post(`/api/v1/leads/${created.id}/activities`, { type: "note", title: "Intro", nextStep: "Qualify", nextStepDueAt: new Date(Date.now() + HOUR).toISOString() });
    expect(res.json().task.assignee.name).toBe("Rahul Kapoor");
  });

  it("validates future dates and a due date without a next step", async () => {
    const maya = await leadId("Maya Chen");
    const future = await rahul.post(`/api/v1/leads/${maya}/activities`, { type: "call", title: "x", occurredAt: new Date(Date.now() + 2 * HOUR).toISOString() });
    expect(future.json().issues.occurredAt).toBeDefined();
    const noStep = await rahul.post(`/api/v1/leads/${maya}/activities`, { type: "call", title: "x", nextStepDueAt: new Date(Date.now() + HOUR).toISOString() });
    expect(noStep.json().issues.nextStep).toBeDefined();
    expect((await rahul.post(`/api/v1/leads/${maya}/activities`, { type: "call", title: "" })).json().issues.title).toBeDefined();
  });

  it("only the author or an admin can edit or delete an activity", async () => {
    const maya = await leadId("Maya Chen");
    const a = (await rahul.post(`/api/v1/leads/${maya}/activities`, { type: "note", title: "Draft" })).json().activity as ActivityDTO;
    expect((await aisha.patch(`/api/v1/activities/${a.id}`, { title: "Hijack" })).statusCode).toBe(403);
    expect((await rahul.patch(`/api/v1/activities/${a.id}`, { title: "Final", body: "More detail" })).json().activity).toMatchObject({ title: "Final", body: "More detail" });
    const asAisha = (await aisha.get(`/api/v1/leads/${maya}/activities`)).json().activities as ActivityDTO[];
    expect(asAisha.find((x) => x.id === a.id)!.canEdit).toBe(false);
    expect((await aisha.delete(`/api/v1/activities/${a.id}`)).statusCode).toBe(403);
    expect((await admin.delete(`/api/v1/activities/${a.id}`)).statusCode).toBe(204);
  });
});

describe("task views", () => {
  it("every open task is in exactly one of overdue / today / upcoming", async () => {
    const [open, overdue, today, upcoming] = await Promise.all(["open", "overdue", "today", "upcoming"].map((v) => tasksFor(admin, `?view=${v}`)));
    expect(open).toHaveLength(8);
    const ids = [...overdue, ...today, ...upcoming].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(open.map((t) => t.id).sort());
    expect(overdue.every((t) => new Date(t.dueAt!) < new Date())).toBe(true);
    expect(overdue.map((t) => t.title)).toEqual(expect.arrayContaining(["Send revised proposal to Northstar", "Discovery call with Maya Chen"]));
    expect(upcoming.map((t) => t.title)).toEqual(expect.arrayContaining(["Schedule stakeholder workshop"]));
  });

  it("filters by assignee, including 'me', and lists completed tasks", async () => {
    const mine = await tasksFor(aisha, "?view=open&assigneeId=me");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((t) => t.assignee.name === "Aisha Rahman")).toBe(true);
    const rahulsTasks = await tasksFor(admin, `?view=open&assigneeId=${user("Rahul").id}`);
    expect(rahulsTasks.every((t) => t.assignee.name === "Rahul Kapoor")).toBe(true);
    const done = await tasksFor(admin, "?view=completed");
    expect(done.map((t) => t.title)).toEqual(["Update project estimate"]);
  });

  it("stats agree with the views, and the sidebar summary counts my overdue + today", async () => {
    const s = await stats(aisha, "?assigneeId=me");
    const overdue = await tasksFor(aisha, "?view=overdue&assigneeId=me");
    const today = await tasksFor(aisha, "?view=today&assigneeId=me");
    expect(s.overdue).toBe(overdue.length);
    expect(s.dueToday).toBe(today.length);
    expect(s.completedThisWeek).toBe(1);
    expect((await aisha.get("/api/v1/me/summary")).json().tasksDue).toBe(overdue.length + today.length);
  });
});

describe("task changes", () => {
  it("creates tasks with validation", async () => {
    const maya = await leadId("Maya Chen");
    const ok = await rahul.post("/api/v1/tasks", { title: "Prep deck", assigneeId: user("Rahul").id, leadId: maya, dueAt: new Date(Date.now() + 2 * HOUR).toISOString() });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().task).toMatchObject({ title: "Prep deck", lead: { fullName: "Maya Chen" }, canEdit: true });

    await admin.patch(`/api/v1/users/${user("Mia").id}`, { active: false });
    const inactive = await rahul.post("/api/v1/tasks", { title: "x", assigneeId: user("Mia").id });
    expect(inactive.json().issues.assigneeId).toBeDefined();
    const noLead = await rahul.post("/api/v1/tasks", { title: "x", assigneeId: user("Rahul").id, leadId: crypto.randomUUID() });
    expect(noLead.json().issues.leadId).toBeDefined();
    expect((await rahul.post("/api/v1/tasks", { title: " ", assigneeId: user("Rahul").id })).json().issues.title).toBeDefined();
  });

  it("completing: allowed for assignee/creator/lead owner/admin, records the event, and can be undone", async () => {
    const task = (await tasksFor(admin, "?view=open")).find((t) => t.title === "Send revised proposal to Northstar")!; // Aisha's, on Maya
    expect((await rahul.patch(`/api/v1/tasks/${task.id}`, { completed: true })).statusCode).toBe(403);
    const done = await aisha.patch(`/api/v1/tasks/${task.id}`, { completed: true });
    expect(done.json().task.completedAt).not.toBeNull();
    expect((await stats(aisha, "?assigneeId=me")).completedThisWeek).toBe(2);
    const undone = await aisha.patch(`/api/v1/tasks/${task.id}`, { completed: false });
    expect(undone.json().task.completedAt).toBeNull();
  });

  it("reschedules, reassigns and deletes", async () => {
    const task = (await tasksFor(admin, "?view=open")).find((t) => t.title === "Prepare kickoff agenda")!; // Rahul's
    const due = new Date(Date.now() + 5 * 24 * HOUR).toISOString();
    const res = await rahul.patch(`/api/v1/tasks/${task.id}`, { dueAt: due, assigneeId: user("Aisha").id, title: "Prepare kickoff agenda v2" });
    expect(res.json().task).toMatchObject({ dueAt: due, assignee: { name: "Aisha Rahman" }, title: "Prepare kickoff agenda v2" });
    // Rahul created it, so he can still delete it after handing it over.
    expect((await rahul.delete(`/api/v1/tasks/${task.id}`)).statusCode).toBe(204);
  });

  it("only admins and the lead's owner can give a task to someone else", async () => {
    const maya = await leadId("Maya Chen"); // owned by Aisha
    const later = new Date(Date.now() + 3 * HOUR).toISOString();
    // A member can always take a task themselves…
    expect((await rahul.post("/api/v1/tasks", { title: "Self", assigneeId: user("Rahul").id, leadId: maya, dueAt: later })).statusCode).toBe(201);
    // …but can't hand one to a teammate on someone else's lead, or with no lead at all.
    const onOthersLead = await rahul.post("/api/v1/tasks", { title: "For Aisha", assigneeId: user("Aisha").id, leadId: maya });
    expect(onOthersLead.statusCode).toBe(400);
    expect(onOthersLead.json().issues.assigneeId[0]).toMatch(/own its lead or be an admin/);
    expect((await rahul.post("/api/v1/tasks", { title: "For Aisha", assigneeId: user("Aisha").id })).json().issues.assigneeId).toBeDefined();
    // The lead's owner and admins can.
    const byOwner = await aisha.post("/api/v1/tasks", { title: "Rahul, call Maya", assigneeId: user("Rahul").id, leadId: maya, dueAt: later });
    expect(byOwner.statusCode).toBe(201);
    expect((await admin.post("/api/v1/tasks", { title: "Admin hand-off", assigneeId: user("Aisha").id })).statusCode).toBe(201);

    // Reassigning follows the same rule; editing other fields of a task you were given still works.
    const given = byOwner.json().task;
    expect((await rahul.patch(`/api/v1/tasks/${given.id}`, { title: "Rahul, call Maya today" })).statusCode).toBe(200);
    expect((await rahul.patch(`/api/v1/tasks/${given.id}`, { assigneeId: user("Aisha").id })).statusCode).toBe(400);
    expect((await aisha.patch(`/api/v1/tasks/${given.id}`, { assigneeId: user("Aisha").id })).statusCode).toBe(200);
    // Moving a teammate's task onto a lead you don't own counts as assigning it there.
    const own = (await rahul.post("/api/v1/tasks", { title: "Mine", assigneeId: user("Rahul").id })).json().task;
    expect((await aisha.patch(`/api/v1/tasks/${own.id}`, { leadId: maya })).statusCode).toBe(403); // not hers to edit at all
    expect((await admin.patch(`/api/v1/tasks/${own.id}`, { leadId: maya })).statusCode).toBe(200);
  });

  it("tasks on a deleted lead disappear", async () => {
    const owen = await leadId("Owen Wright");
    const before = (await tasksFor(admin, "?view=completed")).length;
    await aisha.delete(`/api/v1/leads/${owen}`);
    expect((await tasksFor(admin, "?view=completed")).length).toBe(before - 1);
  });
});
