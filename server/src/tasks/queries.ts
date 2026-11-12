import { and, count, desc, eq, gte, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { TaskDTO, TaskStatsDTO, TaskView } from "@crm/shared";
import { schema, type Database } from "../db/client";
import { canEditTask } from "../leads/policy";
import { toUserRef } from "../leads/queries";
import { endOfTodaySql } from "../lib/time";

const { tasks, users, leads } = schema;
const assignee = alias(users, "assignee");
const creator = alias(users, "task_creator");
type UserRow = typeof users.$inferSelect;

/** Tasks on deleted leads disappear with the lead. */
const visible = or(isNull(tasks.leadId), isNull(leads.deletedAt))!;

/**
 * overdue  – open, due before now
 * today    – open, due from now until local midnight (workspace time zone)
 * upcoming – open, due after today, or with no due date
 * open     – every open task
 */
async function viewFilter(db: Database, view: TaskView | "all"): Promise<SQL | undefined> {
  const open = isNull(tasks.completedAt);
  switch (view) {
    case "overdue": return and(open, lt(tasks.dueAt, sql`now()`));
    case "today": return and(open, gte(tasks.dueAt, sql`now()`), lt(tasks.dueAt, await endOfTodaySql(db)));
    case "upcoming": return and(open, or(isNull(tasks.dueAt), gte(tasks.dueAt, await endOfTodaySql(db))));
    case "open": return open;
    case "completed": return isNotNull(tasks.completedAt);
    case "all": return undefined;
  }
}

export async function listTasks(
  db: Database,
  q: { view: TaskView | "all"; assigneeId?: string; leadId?: string; limit?: number; taskId?: string },
  viewer: UserRow,
): Promise<TaskDTO[]> {
  const where = and(
    visible,
    await viewFilter(db, q.view),
    q.assigneeId ? eq(tasks.assigneeId, q.assigneeId) : undefined,
    q.leadId ? eq(tasks.leadId, q.leadId) : undefined,
    q.taskId ? eq(tasks.id, q.taskId) : undefined,
  );
  const order =
    q.view === "completed" ? [desc(tasks.completedAt)]
    : q.view === "all" ? [sql`${tasks.completedAt} is not null`, sql`${tasks.dueAt} asc nulls last`, desc(tasks.completedAt)]
    : [sql`${tasks.dueAt} asc nulls last`, tasks.createdAt];
  const rows = await db
    .select({ t: tasks, assignee, creator, lead: { id: leads.id, fullName: leads.fullName, company: leads.company, ownerId: leads.ownerId } })
    .from(tasks)
    .innerJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .leftJoin(creator, eq(creator.id, tasks.createdBy))
    .leftJoin(leads, eq(leads.id, tasks.leadId))
    .where(where)
    .orderBy(...order)
    .limit(q.limit ?? 200);
  return rows.map(({ t, assignee: a, creator: c, lead }) => ({
    id: t.id,
    title: t.title,
    dueAt: t.dueAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    assignee: toUserRef(a)!,
    lead: lead?.id ? { id: lead.id, fullName: lead.fullName, company: lead.company, ownerId: lead.ownerId } : null,
    createdBy: toUserRef(c),
    createdAt: t.createdAt.toISOString(),
    canEdit: canEditTask(viewer, t, lead?.ownerId ?? null),
  }));
}

export async function taskStats(db: Database, assigneeId?: string): Promise<TaskStatsDTO> {
  const count_ = async (filter: SQL | undefined) => {
    const [{ n }] = await db
      .select({ n: count() })
      .from(tasks)
      .leftJoin(leads, eq(leads.id, tasks.leadId))
      .where(and(visible, filter, assigneeId ? eq(tasks.assigneeId, assigneeId) : undefined));
    return n;
  };
  const [overdue, dueToday, upcoming, completedThisWeek] = await Promise.all([
    count_(await viewFilter(db, "overdue")),
    count_(await viewFilter(db, "today")),
    count_(await viewFilter(db, "upcoming")),
    count_(gte(tasks.completedAt, sql`now() - interval '7 days'`)),
  ]);
  return { overdue, dueToday, upcoming, completedThisWeek };
}
