import { and, asc, desc, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  leadInput,
  leadListQuery,
  leadUpdate,
  moveLeadInput,
  type ActivityDTO,
  type DocumentDTO,
  type TaskDTO,
  type StageChangeDTO,
  type LeadHistoryEntryDTO,
} from "@crm/shared";
import { currentUser, requireAuth } from "../auth/session";
import { schema, type Database } from "../db/client";
import { diffLead, recordLeadChange } from "../leads/changeLog";
import { canDeleteLead, canEditActivity, canEditLead } from "../leads/policy";
import { listTasks } from "../tasks/queries";
import { getLeadDetail, getLeadRow, listLeads, toStageRef, toUserRef } from "../leads/queries";
import { fieldError, httpError } from "../lib/errors";
import { recordEvent } from "../lib/events";

const { leads, leadTags, pipelineStages, leadSources, users, tags, stageChanges, activities, tasks, documents, leadChanges } = schema;
const idParam = z.object({ id: z.uuid() });
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Checks that referenced source/owner/tags exist, returning field errors instead of FK failures. */
async function validateRefs(db: Database, input: { sourceId?: string | null; ownerId?: string | null; tagIds?: string[] }) {
  const issues: Record<string, string[]> = {};
  if (input.sourceId) {
    const [s] = await db.select({ id: leadSources.id }).from(leadSources).where(and(eq(leadSources.id, input.sourceId), isNull(leadSources.archivedAt))).limit(1);
    if (!s) issues.sourceId = ["That source no longer exists."];
  }
  if (input.ownerId) {
    const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, input.ownerId), isNull(users.deactivatedAt))).limit(1);
    if (!u) issues.ownerId = ["Choose an active team member."];
  }
  if (input.tagIds?.length) {
    const unique = [...new Set(input.tagIds)];
    const found = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, unique));
    if (found.length !== unique.length) issues.tagIds = ["One or more tags no longer exist."];
  }
  if (Object.keys(issues).length) throw fieldError(issues);
}

async function assertNoDuplicateEmail(db: Database, email: string | null | undefined, exceptId?: string) {
  if (!email) return;
  const [dup] = await db
    .select({ id: leads.id, fullName: leads.fullName })
    .from(leads)
    .where(and(eq(sql`lower(${leads.email})`, email.toLowerCase()), isNull(leads.deletedAt), exceptId ? ne(leads.id, exceptId) : undefined))
    .limit(1);
  if (dup) throw httpError(409, "duplicate_email", `${dup.fullName} already uses this email.`, { lead: dup });
}

async function setTags(tx: Tx, leadId: string, tagIds: string[]) {
  await tx.delete(leadTags).where(eq(leadTags.leadId, leadId));
  const unique = [...new Set(tagIds)];
  if (unique.length) await tx.insert(leadTags).values(unique.map((tagId) => ({ leadId, tagId })));
}

const nextPosition = async (db: Database | Tx, stageId: string) => {
  const [{ value }] = await db.select({ value: max(leads.position) }).from(leads).where(and(eq(leads.stageId, stageId), isNull(leads.deletedAt)));
  return (value ?? -1) + 1;
};

const dateOrNull = (v: string | null | undefined) => (v ? new Date(v) : null);

const leadRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  const loadEditable = async (request: Parameters<typeof currentUser>[0], id: string) => {
    const me = currentUser(request);
    const lead = await getLeadRow(app.db, id);
    if (!lead) throw httpError(404, "not_found", "This lead doesn't exist or was deleted.");
    if (!canEditLead(me, lead)) throw httpError(403, "forbidden", "Only the lead's owner or an admin can change this lead.");
    return { me, lead };
  };

  const detailOrThrow = async (id: string, viewer: ReturnType<typeof currentUser>) => {
    const detail = await getLeadDetail(app.db, id, viewer);
    if (!detail) throw httpError(404, "not_found", "This lead doesn't exist or was deleted.");
    return detail;
  };

  // ---------- List ----------
  app.get("/leads", async (request) => listLeads(app.db, leadListQuery.parse(request.query), currentUser(request)));

  // ---------- Create ----------
  app.post("/leads", async (request, reply) => {
    const me = currentUser(request);
    const input = leadInput.parse(request.body);
    await validateRefs(app.db, input);
    if (!input.allowDuplicate) await assertNoDuplicateEmail(app.db, input.email);

    const [stage] = input.stageId
      ? await app.db.select().from(pipelineStages).where(and(eq(pipelineStages.id, input.stageId), isNull(pipelineStages.archivedAt))).limit(1)
      : await app.db.select().from(pipelineStages).where(and(eq(pipelineStages.kind, "open"), isNull(pipelineStages.archivedAt))).orderBy(asc(pipelineStages.position)).limit(1);
    if (!stage) throw fieldError({ stageId: ["Choose a pipeline stage."] });
    if (stage.kind === "lost") throw fieldError({ stageId: ["Create the lead first, then mark it as lost."] });

    const now = new Date();
    const leadId = await app.db.transaction(async (tx) => {
      const { tagIds, allowDuplicate: _ignored, stageId: _s, nextFollowupAt, ...fields } = input;
      const [lead] = await tx
        .insert(leads)
        .values({
          ...fields,
          stageId: stage.id,
          position: await nextPosition(tx, stage.id),
          nextFollowupAt: dateOrNull(nextFollowupAt),
          pinnedBy: fields.pinnedNote ? me.id : null,
          pinnedAt: fields.pinnedNote ? now : null,
          wonAt: stage.kind === "won" ? now : null,
          createdBy: me.id,
          lastActivityAt: now,
        })
        .returning({ id: leads.id });
      if (tagIds?.length) await setTags(tx, lead.id, tagIds);
      await tx.insert(stageChanges).values({ leadId: lead.id, fromStageId: null, toStageId: stage.id, changedBy: me.id, changedAt: now });
      await recordEvent(tx, { type: "lead.created", actorId: me.id, leadId: lead.id, payload: { name: fields.fullName } });
      if (fields.ownerId && fields.ownerId !== me.id) {
        await recordEvent(tx, { type: "lead.assigned", actorId: me.id, leadId: lead.id, subjectId: fields.ownerId });
      }
      return lead.id;
    });
    return reply.status(201).send({ lead: await detailOrThrow(leadId, me) });
  });

  // ---------- Read ----------
  app.get("/leads/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    return { lead: await detailOrThrow(id, currentUser(request)) };
  });

  // ---------- Update ----------
  app.patch("/leads/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    const { me, lead } = await loadEditable(request, id);
    const input = leadUpdate.parse(request.body);
    // Only re-check references that change: a lead may keep an owner who has since been
    // deactivated, or a source that was archived, without blocking unrelated edits.
    await validateRefs(app.db, {
      sourceId: input.sourceId !== lead.sourceId ? input.sourceId : undefined,
      ownerId: input.ownerId !== lead.ownerId ? input.ownerId : undefined,
      tagIds: input.tagIds,
    });
    if (input.email !== undefined && input.email !== lead.email && !input.allowDuplicate) await assertNoDuplicateEmail(app.db, input.email, id);

    const { tagIds, allowDuplicate: _ignored, nextFollowupAt, ...fields } = input;
    const set: Partial<typeof leads.$inferInsert> = { ...fields };
    if (nextFollowupAt !== undefined) set.nextFollowupAt = dateOrNull(nextFollowupAt);
    if (fields.pinnedNote !== undefined && fields.pinnedNote !== lead.pinnedNote) {
      set.pinnedBy = fields.pinnedNote ? me.id : null;
      set.pinnedAt = fields.pinnedNote ? new Date() : null;
    }

    await app.db.transaction(async (tx) => {
      // Record what changed before writing (the diff needs the old tags).
      await recordLeadChange(tx, { leadId: id, actorId: me.id, action: "updated", changes: await diffLead(tx, lead, set, tagIds) });
      if (Object.keys(set).length) await tx.update(leads).set(set).where(eq(leads.id, id));
      if (tagIds) await setTags(tx, id, tagIds);
      if (fields.ownerId !== undefined && fields.ownerId !== lead.ownerId && fields.ownerId) {
        await recordEvent(tx, { type: "lead.assigned", actorId: me.id, leadId: id, subjectId: fields.ownerId });
      }
      if (set.pinnedNote) await recordEvent(tx, { type: "note.pinned", actorId: me.id, leadId: id });
    });
    return { lead: await detailOrThrow(id, me) };
  });

  // ---------- Delete (soft) ----------
  app.delete("/leads/:id", async (request, reply) => {
    const me = currentUser(request);
    const { id } = idParam.parse(request.params);
    const lead = await getLeadRow(app.db, id);
    if (!lead) throw httpError(404, "not_found", "This lead doesn't exist or was deleted.");
    if (!canDeleteLead(me, lead)) throw httpError(403, "forbidden", "Only the lead's owner or an admin can delete this lead.");
    await app.db.transaction(async (tx) => {
      await tx.update(leads).set({ deletedAt: new Date() }).where(eq(leads.id, id));
      await recordLeadChange(tx, { leadId: id, actorId: me.id, action: "deleted" });
    });
    return reply.status(204).send();
  });

  // ---------- Move between / within stages ----------
  app.post("/leads/:id/move", async (request) => {
    const { id } = idParam.parse(request.params);
    const { me, lead } = await loadEditable(request, id);
    const input = moveLeadInput.parse(request.body);
    const [target] = await app.db.select().from(pipelineStages).where(and(eq(pipelineStages.id, input.stageId), isNull(pipelineStages.archivedAt))).limit(1);
    if (!target) throw fieldError({ stageId: ["That stage no longer exists."] });
    const stageChanged = target.id !== lead.stageId;
    if (stageChanged && target.kind === "lost" && !input.lostReason) throw fieldError({ lostReason: ["Choose why this lead was lost."] });

    const [from] = await app.db.select().from(pipelineStages).where(eq(pipelineStages.id, lead.stageId)).limit(1);
    const now = new Date();

    await app.db.transaction(async (tx) => {
      // Re-number the target column with the lead at the requested index.
      const column = await tx
        .select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.stageId, target.id), isNull(leads.deletedAt), ne(leads.id, id)))
        .orderBy(asc(leads.position), asc(leads.createdAt));
      const ids = column.map((c) => c.id);
      ids.splice(Math.min(input.position ?? ids.length, ids.length), 0, id);
      for (const [position, leadId] of ids.entries()) {
        if (leadId !== id) await tx.update(leads).set({ position }).where(eq(leads.id, leadId));
      }

      const set: Partial<typeof leads.$inferInsert> = { stageId: target.id, position: ids.indexOf(id) };
      if (stageChanged) {
        set.wonAt = target.kind === "won" ? now : null;
        set.lostAt = target.kind === "lost" ? now : null;
        set.lostReason = target.kind === "lost" ? input.lostReason! : null;
        set.lostNotes = target.kind === "lost" ? input.lostNotes ?? null : null;
        set.lastActivityAt = now;
      }
      await tx.update(leads).set(set).where(eq(leads.id, id));

      if (stageChanged) {
        await tx.insert(stageChanges).values({ leadId: id, fromStageId: lead.stageId, toStageId: target.id, changedBy: me.id, changedAt: now });
        const type = target.kind === "won" ? "lead.won" : target.kind === "lost" ? "lead.lost" : "lead.stage_changed";
        await recordEvent(tx, { type, actorId: me.id, leadId: id, payload: { from: from?.name ?? null, to: target.name, ...(input.lostReason ? { reason: input.lostReason } : {}) } });
      }
    });
    return { lead: await detailOrThrow(id, me) };
  });

  // ---------- Detail tabs ----------
  const assertLeadExists = async (id: string) => {
    if (!(await getLeadRow(app.db, id))) throw httpError(404, "not_found", "This lead doesn't exist or was deleted.");
  };

  app.get("/leads/:id/activities", async (request): Promise<{ activities: ActivityDTO[] }> => {
    const { id } = idParam.parse(request.params);
    await assertLeadExists(id);
    const rows = await app.db
      .select({ a: activities, author: users })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.authorId))
      .where(eq(activities.leadId, id))
      .orderBy(desc(activities.occurredAt));
    const me = currentUser(request);
    return {
      activities: rows.map(({ a, author }) => ({
        id: a.id, type: a.type, occurredAt: a.occurredAt.toISOString(), title: a.title, body: a.body, nextStep: a.nextStep, author: toUserRef(author),
        canEdit: canEditActivity(me, a),
      })),
    };
  });

  /** Open tasks first (soonest due), then completed ones. */
  app.get("/leads/:id/tasks", async (request): Promise<{ tasks: TaskDTO[] }> => {
    const { id } = idParam.parse(request.params);
    await assertLeadExists(id);
    return { tasks: await listTasks(app.db, { view: "all", leadId: id }, currentUser(request)) };
  });

  /** Stage moves and field edits together, newest first. */
  app.get("/leads/:id/history", async (request): Promise<{ history: LeadHistoryEntryDTO[] }> => {
    const { id } = idParam.parse(request.params);
    await assertLeadExists(id);
    const fromStage = alias(pipelineStages, "from_stage");
    const [moves, edits] = await Promise.all([
      app.db
        .select({ c: stageChanges, from: fromStage, to: pipelineStages, by: users })
        .from(stageChanges)
        .innerJoin(pipelineStages, eq(pipelineStages.id, stageChanges.toStageId))
        .leftJoin(fromStage, eq(fromStage.id, stageChanges.fromStageId))
        .leftJoin(users, eq(users.id, stageChanges.changedBy))
        .where(eq(stageChanges.leadId, id)),
      app.db.select({ c: leadChanges, by: users }).from(leadChanges).leftJoin(users, eq(users.id, leadChanges.actorId)).where(eq(leadChanges.leadId, id)),
    ]);
    const history: LeadHistoryEntryDTO[] = [
      ...moves.map(({ c, from, to, by }): LeadHistoryEntryDTO => ({ id: c.id, kind: "stage", at: c.changedAt.toISOString(), by: toUserRef(by), from: from ? toStageRef(from) : null, to: toStageRef(to) })),
      ...edits.map(({ c, by }): LeadHistoryEntryDTO =>
        c.action === "deleted"
          ? { id: c.id, kind: "deleted", at: c.createdAt.toISOString(), by: toUserRef(by) }
          : { id: c.id, kind: "updated", at: c.createdAt.toISOString(), by: toUserRef(by), changes: c.changes }),
    ];
    // Newest first; on a tie (same transaction) show edits after the stage move they came with.
    history.sort((a, b) => b.at.localeCompare(a.at) || (a.kind === "stage" ? 1 : -1));
    return { history };
  });

  app.get("/leads/:id/stage-history", async (request): Promise<{ history: StageChangeDTO[] }> => {
    const { id } = idParam.parse(request.params);
    await assertLeadExists(id);
    const fromStage = alias(pipelineStages, "from_stage");
    const rows = await app.db
      .select({ c: stageChanges, from: fromStage, to: pipelineStages, by: users })
      .from(stageChanges)
      .innerJoin(pipelineStages, eq(pipelineStages.id, stageChanges.toStageId))
      .leftJoin(fromStage, eq(fromStage.id, stageChanges.fromStageId))
      .leftJoin(users, eq(users.id, stageChanges.changedBy))
      .where(eq(stageChanges.leadId, id))
      .orderBy(desc(stageChanges.changedAt));
    return {
      history: rows.map(({ c, from, to, by }) => ({
        id: c.id, from: from ? toStageRef(from) : null, to: toStageRef(to), changedBy: toUserRef(by), changedAt: c.changedAt.toISOString(),
      })),
    };
  });
};

export default leadRoutes;
