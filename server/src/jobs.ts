import { and, eq, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { schema, type Database } from "./db/client";
import { env } from "./env";
import { trackError } from "./lib/errorTracker";
import { recordEvent } from "./lib/events";
import { endOfTodaySql, workspaceTimezone } from "./lib/time";

const { leads, pipelineStages, tasks, events, sessions, passwordResets, invitations, jobRuns } = schema;

/**
 * Background work, safe to run repeatedly (every run is idempotent):
 * - "follow-up due today" reminders for lead owners,
 * - "task due today" reminders for assignees,
 * - clean-up of expired sessions, used/expired reset links and stale invites.
 * Reminders are sent once per lead/task per day (deduplicated through the events table).
 */
export async function runJobs(db: Database) {
  const tz = await workspaceTimezone(db);
  const startOfToday = sql`(date_trunc('day', now() at time zone ${tz}) at time zone ${tz})`;
  const endOfToday = await endOfTodaySql(db);

  // Follow-ups due today on open deals with an owner.
  const dueLeads = await db
    .select({ id: leads.id, ownerId: leads.ownerId, fullName: leads.fullName, dueAt: leads.nextFollowupAt })
    .from(leads)
    .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
    .where(and(isNull(leads.deletedAt), isNotNull(leads.ownerId), eq(pipelineStages.kind, "open"), gte(leads.nextFollowupAt, startOfToday), lt(leads.nextFollowupAt, endOfToday)));
  let followups = 0;
  for (const lead of dueLeads) {
    const [already] = await db.select({ id: events.id }).from(events).where(and(eq(events.type, "followup.due"), eq(events.leadId, lead.id), gte(events.createdAt, startOfToday))).limit(1);
    if (already) continue;
    await recordEvent(db, { type: "followup.due", actorId: null, leadId: lead.id, payload: { dueAt: lead.dueAt?.toISOString(), name: lead.fullName } });
    followups++;
  }

  // Open tasks due today.
  const dueTasks = await db
    .select({ id: tasks.id, title: tasks.title, assigneeId: tasks.assigneeId, leadId: tasks.leadId, dueAt: tasks.dueAt })
    .from(tasks)
    .leftJoin(leads, eq(leads.id, tasks.leadId))
    .where(and(isNull(tasks.completedAt), or(isNull(tasks.leadId), isNull(leads.deletedAt)), gte(tasks.dueAt, startOfToday), lt(tasks.dueAt, endOfToday)));
  let taskReminders = 0;
  for (const task of dueTasks) {
    const [already] = await db.select({ id: events.id }).from(events).where(and(eq(events.type, "task.due"), eq(events.subjectId, task.id), gte(events.createdAt, startOfToday))).limit(1);
    if (already) continue;
    await recordEvent(db, { type: "task.due", actorId: null, leadId: task.leadId, subjectId: task.id, payload: { title: task.title, assigneeId: task.assigneeId, dueAt: task.dueAt?.toISOString() } });
    taskReminders++;
  }

  // Clean-up.
  const expiredSessions = await db.delete(sessions).where(lt(sessions.expiresAt, sql`now()`)).returning({ id: sessions.id });
  const oldResets = await db.delete(passwordResets).where(lt(passwordResets.expiresAt, sql`now() - interval '7 days'`)).returning({ id: passwordResets.id });
  const staleInvites = await db.delete(invitations).where(and(isNull(invitations.acceptedAt), lt(invitations.expiresAt, sql`now() - interval '30 days'`))).returning({ id: invitations.id });

  return { followups, taskReminders, expiredSessions: expiredSessions.length, oldResets: oldResets.length, staleInvites: staleInvites.length };
}

/**
 * Runs the jobs unless some instance already ran them in the last `intervalMinutes`.
 * The check is one atomic UPDATE, so with many instances (serverless, or several VPS
 * processes) exactly one of them does the work per interval. Returns null when skipped.
 */
export async function runJobsIfDue(db: Database, intervalMinutes = env.JOBS_INTERVAL_MINUTES) {
  await db.insert(jobRuns).values({ name: "reminders", lastRunAt: sql`'epoch'::timestamptz` }).onConflictDoNothing();
  const claimed = await db
    .update(jobRuns)
    .set({ lastRunAt: sql`now()` })
    .where(and(eq(jobRuns.name, "reminders"), lt(jobRuns.lastRunAt, sql`now() - make_interval(mins => ${intervalMinutes})`)))
    .returning({ name: jobRuns.name });
  if (!claimed.length) return null;
  return runJobs(db);
}

/** Starts the in-process scheduler (only when JOBS_ENABLED). Returns a stop function. */
export function startJobs(db: Database, log: FastifyBaseLogger) {
  if (!env.JOBS_ENABLED) {
    log.info("Background jobs disabled (JOBS_ENABLED=false)");
    return () => {};
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runJobsIfDue(db);
      if (result) log.info({ jobs: result }, "Background jobs ran");
    } catch (error) {
      log.error({ err: error }, "Background jobs failed");
      await trackError(db, { source: "server", message: `Background jobs failed: ${(error as Error).message}`, stack: (error as Error).stack, path: "jobs" });
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, env.JOBS_INTERVAL_MINUTES * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
