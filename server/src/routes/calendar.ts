import { and, eq, gte, inArray, isNull, lt, type SQL } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { CALENDAR_KINDS, calendarQuery, type CalendarItemDTO, type CalendarKind } from "@crm/shared";
import { requireAuth } from "../auth/session";
import { schema } from "../db/client";
import { toUserRef } from "../leads/queries";
import { workspaceTimezone } from "../lib/time";

const { activities, tasks, leads, users, pipelineStages } = schema;
const ACTIVITY_KINDS = ["meeting", "call", "email", "note"] as const;

/** YYYY-MM-DD of a moment in a time zone. */
const dayIn = (tz: string, date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

/**
 * The team calendar: logged activities, task due dates, lead follow-ups and expected close
 * dates in one feed. Everyone signed in sees the whole team (like the rest of the CRM);
 * `userId` narrows it to one person.
 */
const calendarRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/calendar", async (request): Promise<{ items: CalendarItemDTO[] }> => {
    const q = calendarQuery.parse(request.query);
    const from = new Date(q.from);
    const to = new Date(q.to);
    const wanted = new Set<CalendarKind>(q.kinds ? (q.kinds.split(",").filter((k) => (CALENDAR_KINDS as readonly string[]).includes(k)) as CalendarKind[]) : CALENDAR_KINDS);
    const by = (column: SQL | Parameters<typeof eq>[0]): SQL | undefined => (q.userId ? eq(column as never, q.userId) : undefined);
    const lead = { id: leads.id, fullName: leads.fullName };
    const jobs: Promise<CalendarItemDTO[]>[] = [];

    const activityKinds = ACTIVITY_KINDS.filter((k) => wanted.has(k));
    if (activityKinds.length) {
      jobs.push(
        app.db
          .select({ a: activities, lead, person: users })
          .from(activities)
          .innerJoin(leads, eq(leads.id, activities.leadId))
          .leftJoin(users, eq(users.id, activities.authorId))
          .where(and(isNull(leads.deletedAt), inArray(activities.type, activityKinds), gte(activities.occurredAt, from), lt(activities.occurredAt, to), by(activities.authorId)))
          .then((rows) => rows.map(({ a, lead: l, person }) => ({ id: `${a.type}:${a.id}`, kind: a.type, title: a.title, at: a.occurredAt.toISOString(), allDay: false, done: true, lead: l, person: toUserRef(person) }))),
      );
    }

    if (wanted.has("task")) {
      jobs.push(
        app.db
          .select({ t: tasks, lead: { id: leads.id, fullName: leads.fullName, deletedAt: leads.deletedAt }, person: users })
          .from(tasks)
          .leftJoin(leads, eq(leads.id, tasks.leadId))
          .innerJoin(users, eq(users.id, tasks.assigneeId))
          .where(and(gte(tasks.dueAt, from), lt(tasks.dueAt, to), by(tasks.assigneeId)))
          .then((rows) =>
            rows
              .filter((r) => !r.lead?.deletedAt)
              .map(({ t, lead: l, person }) => ({ id: `task:${t.id}`, kind: "task" as const, title: t.title, at: t.dueAt!.toISOString(), allDay: false, done: !!t.completedAt, lead: l?.id ? { id: l.id, fullName: l.fullName } : null, person: toUserRef(person) })),
          ),
      );
    }

    // Follow-ups and expected close dates only matter for deals still open.
    const openLeads = (extra: SQL | undefined) =>
      app.db
        .select({ l: leads, person: users })
        .from(leads)
        .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
        .leftJoin(users, eq(users.id, leads.ownerId))
        .where(and(isNull(leads.deletedAt), eq(pipelineStages.kind, "open"), by(leads.ownerId), extra));

    if (wanted.has("followup")) {
      jobs.push(
        openLeads(and(gte(leads.nextFollowupAt, from), lt(leads.nextFollowupAt, to))).then((rows) =>
          rows.map(({ l, person }) => ({ id: `followup:${l.id}`, kind: "followup" as const, title: `Follow up with ${l.fullName}`, at: l.nextFollowupAt!.toISOString(), allDay: false, done: false, lead: { id: l.id, fullName: l.fullName }, person: toUserRef(person) })),
        ),
      );
    }

    if (wanted.has("close")) {
      const tz = await workspaceTimezone(app.db);
      jobs.push(
        openLeads(and(gte(leads.expectedClose, dayIn(tz, from)), lt(leads.expectedClose, dayIn(tz, to)))).then((rows) =>
          rows.map(({ l, person }) => ({ id: `close:${l.id}`, kind: "close" as const, title: `Expected close: ${l.fullName}`, at: l.expectedClose!, allDay: true, done: false, lead: { id: l.id, fullName: l.fullName }, person: toUserRef(person) })),
        ),
      );
    }

    const items = (await Promise.all(jobs)).flat();
    items.sort((a, b) => (a.allDay === b.allDay ? a.at.localeCompare(b.at) : a.allDay ? -1 : 1) || a.title.localeCompare(b.title));
    return { items };
  });
};

export default calendarRoutes;
