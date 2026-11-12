import { and, asc, count, desc, eq, gte, inArray, isNull, lt, notInArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyPluginAsync } from "fastify";
import { dashboardQuery, feedQuery, goalUpdate, type DashboardDTO, type EventType, type FeedEventDTO, type FeedPageDTO, type GoalDTO } from "@crm/shared";
import { currentUser, requireAdmin, requireAuth } from "../auth/session";
import { schema, type Database } from "../db/client";
import { toStageRef, toUserRef } from "../leads/queries";
import { workspaceTimezone } from "../lib/time";

const { leads, pipelineStages, leadSources, events, users, goals } = schema;
const REMINDER_TYPES: EventType[] = ["followup.due", "task.due"];
/** Never in the team feed: system errors are for admins (Settings → System status). */
const PRIVATE_TYPES: EventType[] = ["system.error"];
const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 } as const;
const money = () => sql<number>`coalesce(sum(${leads.valueCents}), 0)::float8`.mapWith(Number);

/** Start of the current month (as a timestamptz) and its YYYY-MM label, in the workspace time zone. */
async function currentMonth(db: Database) {
  const tz = await workspaceTimezone(db);
  // en-CA formats as YYYY-MM-DD; take the year and month.
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).slice(0, 7);
  return { tz, month, start: sql`(date_trunc('month', now() at time zone ${tz}) at time zone ${tz})` };
}

const actor = alias(users, "actor");
const subject = alias(users, "subject_user");

/** Events joined with their actor, subject user and lead; add `.where/.orderBy/.limit`. */
export const selectEvents = (db: Database) =>
  db
    .select({ e: events, actor, subject, lead: { id: leads.id, fullName: leads.fullName, deletedAt: leads.deletedAt } })
    .from(events)
    .leftJoin(actor, eq(actor.id, events.actorId))
    .leftJoin(subject, eq(subject.id, events.subjectId))
    .leftJoin(leads, eq(leads.id, events.leadId));

type EventJoinRow = Awaited<ReturnType<ReturnType<typeof selectEvents>["limit"]>>[number];

export const toFeedEvent = ({ e, actor: a, subject: s, lead }: EventJoinRow): FeedEventDTO => ({
  id: e.id,
  type: e.type,
  createdAt: e.createdAt.toISOString(),
  actor: toUserRef(a),
  lead: lead?.id ? { id: lead.id, fullName: lead.fullName, deleted: lead.deletedAt !== null } : null,
  subjectUser: toUserRef(s),
  payload: e.payload,
});

export async function goalProgress(db: Database): Promise<GoalDTO> {
  const { month, start } = await currentMonth(db);
  const [[goal], [won]] = await Promise.all([
    db.select().from(goals).where(eq(goals.month, month)).limit(1),
    db
      .select({ value: money() })
      .from(leads)
      .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
      .where(and(isNull(leads.deletedAt), eq(pipelineStages.kind, "won"), gte(leads.wonAt, start))),
  ]);
  return { month, targetCents: goal?.targetCents ?? null, wonCents: won?.value ?? 0 };
}

const insightRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  // ---------- Dashboard ----------
  app.get("/dashboard", async (request): Promise<DashboardDTO> => {
    const me = currentUser(request);
    const q = dashboardQuery.parse(request.query);
    const days = RANGE_DAYS[q.range];
    const since = sql`now() - make_interval(days => ${days})`;
    const prevSince = sql`now() - make_interval(days => ${days * 2})`;
    const live = and(isNull(leads.deletedAt), q.scope === "me" ? eq(leads.ownerId, me.id) : undefined)!;
    const joined = () => app.db.select({ n: count(), value: money() }).from(leads).innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId));
    const one = async (where: SQL | undefined) => (await joined().where(and(live, where)))[0]!;

    const [created, createdPrev, hot, won, wonPrev, lost, lostPrev, open, sourceRows, stages, stageRows] = await Promise.all([
      one(gte(leads.createdAt, since)),
      one(and(gte(leads.createdAt, prevSince), lt(leads.createdAt, since))),
      one(and(eq(pipelineStages.kind, "open"), isNull(pipelineStages.archivedAt), eq(leads.temperature, "hot"))),
      one(and(eq(pipelineStages.kind, "won"), gte(leads.wonAt, since))),
      one(and(eq(pipelineStages.kind, "won"), gte(leads.wonAt, prevSince), lt(leads.wonAt, since))),
      one(and(eq(pipelineStages.kind, "lost"), gte(leads.lostAt, since))),
      one(and(eq(pipelineStages.kind, "lost"), gte(leads.lostAt, prevSince), lt(leads.lostAt, since))),
      one(and(eq(pipelineStages.kind, "open"), isNull(pipelineStages.archivedAt))),
      app.db
        .select({ source: leadSources, n: count() })
        .from(leads)
        .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
        .where(and(live, gte(leads.createdAt, since)))
        .groupBy(leadSources.id)
        .orderBy(desc(count())),
      app.db.select().from(pipelineStages).where(isNull(pipelineStages.archivedAt)).orderBy(asc(pipelineStages.position)),
      app.db.select({ stageId: leads.stageId, n: count(), value: money() }).from(leads).where(live).groupBy(leads.stageId),
    ]);

    const perStage = new Map(stageRows.map((r) => [r.stageId, r]));
    return {
      range: q.range,
      scope: q.scope,
      kpis: {
        newLeads: { value: created.n, previous: createdPrev.n },
        hotLeads: { value: hot.n, previous: null },
        dealsWon: { value: won.n, previous: wonPrev.n },
        wonValueCents: { value: won.value, previous: wonPrev.value },
        pipelineValueCents: { value: open.value, previous: null },
        openDeals: open.n,
        dealsLost: { value: lost.n, previous: lostPrev.n },
        // Share of deals closed in the period that were won; null when nothing closed.
        winRate: {
          value: won.n + lost.n ? won.n / (won.n + lost.n) : null,
          previous: wonPrev.n + lostPrev.n ? wonPrev.n / (wonPrev.n + lostPrev.n) : null,
        },
      },
      bySource: sourceRows.map((r) => ({ source: r.source ? { id: r.source.id, name: r.source.name, color: r.source.color } : null, count: r.n })),
      byStage: stages.map((s) => ({ stage: toStageRef(s), count: perStage.get(s.id)?.n ?? 0, valueCents: perStage.get(s.id)?.value ?? 0 })),
    };
  });

  // ---------- Activity feed ----------
  app.get("/feed", async (request): Promise<FeedPageDTO> => {
    const q = feedQuery.parse(request.query);
    const rows = await selectEvents(app.db)
      .where(and(
        q.before ? lt(events.createdAt, new Date(q.before)) : undefined,
        q.actorId ? eq(events.actorId, q.actorId) : undefined,
        q.leadId ? eq(events.leadId, q.leadId) : undefined,
        // Reminders are personal (they go to the bell); the team feed shows them only when asked for.
        q.type?.length ? inArray(events.type, q.type) : notInArray(events.type, REMINDER_TYPES),
        notInArray(events.type, PRIVATE_TYPES),
      ))
      .orderBy(desc(events.createdAt), desc(events.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    return {
      events: page.map(toFeedEvent),
      nextBefore: rows.length > q.limit ? page.at(-1)!.e.createdAt.toISOString() : null,
    };
  });

  // ---------- Monthly goal ----------
  app.get("/goal", async () => ({ goal: await goalProgress(app.db) }));

  app.put("/goal", { preHandler: requireAdmin }, async (request) => {
    const { month, targetCents } = goalUpdate.parse(request.body);
    if (targetCents === null) await app.db.delete(goals).where(eq(goals.month, month));
    else await app.db.insert(goals).values({ month, targetCents }).onConflictDoUpdate({ target: goals.month, set: { targetCents } });
    return { goal: await goalProgress(app.db) };
  });
};

export default insightRoutes;
