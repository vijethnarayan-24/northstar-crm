import { and, eq, isNull } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { activityInput, activityUpdate, taskInput, taskListQuery, taskStatsQuery, taskUpdate, type MeSummaryDTO } from "@crm/shared";
import { currentUser, requireAuth } from "../auth/session";
import { schema, type Database } from "../db/client";
import { canAssignTask, canEditActivity, canEditTask } from "../leads/policy";
import { getLeadRow, toUserRef } from "../leads/queries";
import { fieldError, httpError } from "../lib/errors";
import { recordEvent } from "../lib/events";
import { listTasks, taskStats } from "../tasks/queries";

const { activities, tasks, leads, users } = schema;
const idParam = z.object({ id: z.uuid() });
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const ASSIGN_RULE = "You can assign tasks to yourself. To give a task to someone else, you need to own its lead or be an admin.";
const notFound = (what: string) => httpError(404, "not_found", `This ${what} doesn't exist or was deleted.`);

async function assertActiveUser(db: Database, userId: string, field = "assigneeId") {
  const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), isNull(users.deactivatedAt))).limit(1);
  if (!u) throw fieldError({ [field]: ["Choose an active team member."] });
}

/** Keeps the lead's "last activity" moving forward only. */
async function touchLead(tx: Tx | Database, leadId: string, at: Date) {
  const [lead] = await tx.select({ last: leads.lastActivityAt }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead?.last || lead.last < at) await tx.update(leads).set({ lastActivityAt: at }).where(eq(leads.id, leadId));
}

const workRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  const activityDTO = async (activityId: string, viewer: ReturnType<typeof currentUser>) => {
    const [row] = await app.db.select({ a: activities, author: users }).from(activities).leftJoin(users, eq(users.id, activities.authorId)).where(eq(activities.id, activityId)).limit(1);
    if (!row) throw notFound("activity");
    const { a, author } = row;
    return { id: a.id, type: a.type, occurredAt: a.occurredAt.toISOString(), title: a.title, body: a.body, nextStep: a.nextStep, author: toUserRef(author), canEdit: canEditActivity(viewer, a) };
  };

  const taskDTO = async (taskId: string, viewer: ReturnType<typeof currentUser>) => {
    const [task] = await listTasks(app.db, { view: "all", taskId }, viewer);
    if (!task) throw notFound("task");
    return task;
  };

  // ---------- Activities ----------
  app.post("/leads/:id/activities", async (request, reply) => {
    const me = currentUser(request);
    const { id: leadId } = idParam.parse(request.params);
    const lead = await getLeadRow(app.db, leadId);
    if (!lead) throw notFound("lead");
    const input = activityInput.parse(request.body);
    if (input.nextStepDueAt && !input.nextStep) throw fieldError({ nextStep: ["Describe the next step, or clear its due date."] });
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) throw fieldError({ occurredAt: ["Activities can't be logged in the future. Add a task instead."] });

    const created = await app.db.transaction(async (tx) => {
      const [activity] = await tx
        .insert(activities)
        .values({ leadId, type: input.type, occurredAt, title: input.title, body: input.body ?? null, nextStep: input.nextStep ?? null, authorId: me.id })
        .returning();
      await touchLead(tx, leadId, occurredAt);
      await recordEvent(tx, { type: "activity.logged", actorId: me.id, leadId, subjectId: activity.id, payload: { activityType: input.type, title: input.title } });

      let taskId: string | null = null;
      if (input.nextStep && input.nextStepDueAt) {
        const dueAt = new Date(input.nextStepDueAt);
        // The next step belongs to whoever owns the lead; unowned leads go to the logger.
        const [task] = await tx.insert(tasks).values({ title: input.nextStep, leadId, assigneeId: lead.ownerId ?? me.id, dueAt, createdBy: me.id }).returning({ id: tasks.id });
        taskId = task.id;
        await tx.update(leads).set({ nextFollowupAt: dueAt }).where(eq(leads.id, leadId));
        await recordEvent(tx, { type: "task.created", actorId: me.id, leadId, subjectId: task.id, payload: { title: input.nextStep, assigneeId: lead.ownerId ?? me.id } });
      }
      return { activityId: activity.id, taskId };
    });
    return reply.status(201).send({
      activity: await activityDTO(created.activityId, me),
      task: created.taskId ? await taskDTO(created.taskId, me) : null,
    });
  });

  app.patch("/activities/:id", async (request) => {
    const me = currentUser(request);
    const { id } = idParam.parse(request.params);
    const [activity] = await app.db.select().from(activities).where(eq(activities.id, id)).limit(1);
    if (!activity) throw notFound("activity");
    if (!canEditActivity(me, activity)) throw httpError(403, "forbidden", "Only the author or an admin can change this activity.");
    const { occurredAt, ...rest } = activityUpdate.parse(request.body);
    const set: Partial<typeof activities.$inferInsert> = { ...rest };
    if (occurredAt) set.occurredAt = new Date(occurredAt);
    if (Object.keys(set).length) {
      await app.db.update(activities).set(set).where(eq(activities.id, id));
      if (set.occurredAt) await touchLead(app.db, activity.leadId, set.occurredAt);
    }
    return { activity: await activityDTO(id, me) };
  });

  app.delete("/activities/:id", async (request, reply) => {
    const me = currentUser(request);
    const { id } = idParam.parse(request.params);
    const [activity] = await app.db.select().from(activities).where(eq(activities.id, id)).limit(1);
    if (!activity) throw notFound("activity");
    if (!canEditActivity(me, activity)) throw httpError(403, "forbidden", "Only the author or an admin can delete this activity.");
    await app.db.delete(activities).where(eq(activities.id, id));
    return reply.status(204).send();
  });

  // ---------- Tasks ----------
  const resolveAssignee = (value: string | undefined, me: { id: string }) => (value === "me" ? me.id : value);

  app.get("/tasks", async (request) => {
    const me = currentUser(request);
    const q = taskListQuery.parse(request.query);
    return { tasks: await listTasks(app.db, { ...q, assigneeId: resolveAssignee(q.assigneeId, me) }, me) };
  });

  app.get("/tasks/stats", async (request) => {
    const me = currentUser(request);
    const q = taskStatsQuery.parse(request.query);
    return { stats: await taskStats(app.db, resolveAssignee(q.assigneeId, me)) };
  });

  /** Small per-user counters for the app shell (sidebar badge). */
  app.get("/me/summary", async (request): Promise<MeSummaryDTO> => {
    const me = currentUser(request);
    const stats = await taskStats(app.db, me.id);
    return { tasksDue: stats.overdue + stats.dueToday };
  });

  const loadTask = async (id: string, me: ReturnType<typeof currentUser>) => {
    const [row] = await app.db.select({ t: tasks, leadOwnerId: leads.ownerId, leadDeleted: leads.deletedAt }).from(tasks).leftJoin(leads, eq(leads.id, tasks.leadId)).where(eq(tasks.id, id)).limit(1);
    if (!row || row.leadDeleted) throw notFound("task");
    if (!canEditTask(me, row.t, row.leadOwnerId)) throw httpError(403, "forbidden", "Only the assignee, the person who created it, the lead's owner or an admin can change this task.");
    return row.t;
  };

  app.post("/tasks", async (request, reply) => {
    const me = currentUser(request);
    const input = taskInput.parse(request.body);
    await assertActiveUser(app.db, input.assigneeId);
    const lead = input.leadId ? await getLeadRow(app.db, input.leadId) : null;
    if (input.leadId && !lead) throw fieldError({ leadId: ["That lead no longer exists."] });
    if (!canAssignTask(me, input.assigneeId, lead?.ownerId ?? null)) throw fieldError({ assigneeId: [ASSIGN_RULE] });
    const [task] = await app.db
      .insert(tasks)
      .values({ title: input.title, leadId: input.leadId ?? null, assigneeId: input.assigneeId, dueAt: input.dueAt ? new Date(input.dueAt) : null, createdBy: me.id })
      .returning({ id: tasks.id });
    await recordEvent(app.db, { type: "task.created", actorId: me.id, leadId: input.leadId ?? null, subjectId: task.id, payload: { title: input.title, assigneeId: input.assigneeId } });
    return reply.status(201).send({ task: await taskDTO(task.id, me) });
  });

  app.patch("/tasks/:id", async (request) => {
    const me = currentUser(request);
    const { id } = idParam.parse(request.params);
    const task = await loadTask(id, me);
    const { completed, dueAt, ...rest } = taskUpdate.parse(request.body);
    if (rest.assigneeId && rest.assigneeId !== task.assigneeId) await assertActiveUser(app.db, rest.assigneeId);
    if (rest.leadId && rest.leadId !== task.leadId && !(await getLeadRow(app.db, rest.leadId))) throw fieldError({ leadId: ["That lead no longer exists."] });
    // Re-check the assignment rule when the task changes hands, or moves to another lead while assigned to someone else.
    const nextAssignee = rest.assigneeId ?? task.assigneeId;
    const nextLeadId = rest.leadId !== undefined ? rest.leadId : task.leadId;
    if (nextAssignee !== task.assigneeId || nextLeadId !== task.leadId) {
      const nextLead = nextLeadId ? await getLeadRow(app.db, nextLeadId) : null;
      if (!canAssignTask(me, nextAssignee, nextLead?.ownerId ?? null)) throw fieldError({ assigneeId: [ASSIGN_RULE] });
    }

    const set: Partial<typeof tasks.$inferInsert> = { ...rest };
    if (dueAt !== undefined) set.dueAt = dueAt ? new Date(dueAt) : null;
    const completing = completed === true && !task.completedAt;
    if (completed !== undefined) set.completedAt = completed ? task.completedAt ?? new Date() : null;

    await app.db.transaction(async (tx) => {
      if (Object.keys(set).length) await tx.update(tasks).set(set).where(eq(tasks.id, id));
      if (completing) {
        await recordEvent(tx, { type: "task.completed", actorId: me.id, leadId: task.leadId, subjectId: id, payload: { title: task.title } });
        if (task.leadId) await touchLead(tx, task.leadId, new Date());
      }
    });
    return { task: await taskDTO(id, me) };
  });

  app.delete("/tasks/:id", async (request, reply) => {
    const me = currentUser(request);
    const { id } = idParam.parse(request.params);
    await loadTask(id, me);
    await app.db.delete(tasks).where(eq(tasks.id, id));
    return reply.status(204).send();
  });
};

export default workRoutes;
