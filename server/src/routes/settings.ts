import { and, asc, count, eq, inArray, isNull, max, ne, notInArray, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  reorderInput,
  sourceInput,
  sourceUpdate,
  stageInput,
  stageRemoveInput,
  stageUpdate,
  tagMergeInput,
  tagUpdate,
  workspaceUpdate,
  type SourceAdminDTO,
  type StageAdminDTO,
  type TagAdminDTO,
  type WorkspaceDTO,
} from "@crm/shared";
import { currentUser, requireAdmin, requireAuth } from "../auth/session";
import { schema, type Database } from "../db/client";
import { fieldError, httpError } from "../lib/errors";
import { recordEvent } from "../lib/events";

const { leadSources, pipelineStages, tags, leadTags, leads, stageChanges, workspace } = schema;
const idParam = z.object({ id: z.uuid() });
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Count of live leads per value of a column, as a Map. */
async function leadCounts(db: Database, column: typeof leads.sourceId | typeof leads.stageId) {
  const rows = await db.select({ key: column, n: count() }).from(leads).where(isNull(leads.deletedAt)).groupBy(column);
  return new Map(rows.map((r) => [r.key, r.n]));
}

/** Keeps open stages in their chosen order, then Won, then Lost. */
async function renumberStages(db: Database | Tx) {
  const rows = await db
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(isNull(pipelineStages.archivedAt))
    .orderBy(sql`case ${pipelineStages.kind} when 'open' then 0 when 'won' then 1 else 2 end`, asc(pipelineStages.position), asc(pipelineStages.createdAt));
  for (const [position, row] of rows.entries()) await db.update(pipelineStages).set({ position }).where(eq(pipelineStages.id, row.id));
}

const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  const assertUniqueName = async (table: typeof leadSources | typeof pipelineStages, name: string, exceptId?: string) => {
    const [dup] = await app.db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(sql`lower(${table.name})`, name.toLowerCase()), isNull(table.archivedAt), exceptId ? ne(table.id, exceptId) : undefined))
      .limit(1);
    if (dup) throw fieldError({ name: [`“${name}” already exists.`] });
  };

  // ---------- Workspace ----------
  const toWorkspace = (w: typeof workspace.$inferSelect): WorkspaceDTO => ({ name: w.name, timezone: w.timezone, currency: w.currency });

  app.get("/workspace", async () => {
    const [w] = await app.db.select().from(workspace).limit(1);
    if (!w) throw httpError(404, "not_found", "Workspace is not set up.");
    return { workspace: toWorkspace(w) };
  });

  app.patch("/workspace", { preHandler: requireAdmin }, async (request) => {
    const changes = workspaceUpdate.parse(request.body);
    const [w] = Object.keys(changes).length
      ? await app.db.update(workspace).set(changes).where(eq(workspace.id, 1)).returning()
      : await app.db.select().from(workspace).limit(1);
    return { workspace: toWorkspace(w) };
  });

  // ---------- Lead sources ----------
  app.get("/settings/sources", async (): Promise<{ sources: SourceAdminDTO[] }> => {
    const [rows, counts] = await Promise.all([
      app.db.select().from(leadSources).orderBy(sql`${leadSources.archivedAt} is not null`, asc(leadSources.position), asc(leadSources.name)),
      leadCounts(app.db, leads.sourceId),
    ]);
    return { sources: rows.map((s) => ({ id: s.id, name: s.name, color: s.color, position: s.position, archived: s.archivedAt !== null, leadCount: counts.get(s.id) ?? 0 })) };
  });

  app.post("/sources", { preHandler: requireAdmin }, async (request, reply) => {
    const input = sourceInput.parse(request.body);
    await assertUniqueName(leadSources, input.name);
    const [{ value }] = await app.db.select({ value: max(leadSources.position) }).from(leadSources);
    const [row] = await app.db.insert(leadSources).values({ ...input, position: (value ?? -1) + 1 }).returning();
    return reply.status(201).send({ source: { id: row.id, name: row.name, color: row.color } });
  });

  app.patch("/sources/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { archived, ...changes } = sourceUpdate.parse(request.body);
    const [current] = await app.db.select().from(leadSources).where(eq(leadSources.id, id)).limit(1);
    if (!current) throw httpError(404, "not_found", "Source not found.");
    // Restoring or renaming must not collide with another active source.
    const finalName = changes.name ?? current.name;
    if (changes.name || archived === false) await assertUniqueName(leadSources, finalName, id);
    const set: Partial<typeof leadSources.$inferInsert> = { ...changes };
    if (archived !== undefined) set.archivedAt = archived ? new Date() : null;
    const [row] = Object.keys(set).length ? await app.db.update(leadSources).set(set).where(eq(leadSources.id, id)).returning() : [current];
    return { source: { id: row.id, name: row.name, color: row.color, archived: row.archivedAt !== null } };
  });

  app.put("/sources/order", { preHandler: requireAdmin }, async (request, reply) => {
    const { ids } = reorderInput.parse(request.body);
    await app.db.transaction(async (tx) => {
      for (const [position, id] of ids.entries()) await tx.update(leadSources).set({ position }).where(eq(leadSources.id, id));
    });
    return reply.status(204).send();
  });

  /** Deletes an unused source. Sources with leads must be archived instead, to keep reporting intact. */
  app.delete("/sources/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const [{ n }] = await app.db.select({ n: count() }).from(leads).where(and(eq(leads.sourceId, id), isNull(leads.deletedAt)));
    if (n > 0) throw httpError(409, "in_use", `This source is used by ${n} lead${n === 1 ? "" : "s"}. Archive it instead to hide it from new leads.`);
    await app.db.update(leads).set({ sourceId: null }).where(eq(leads.sourceId, id)); // soft-deleted leads only
    await app.db.delete(leadSources).where(eq(leadSources.id, id));
    return reply.status(204).send();
  });

  // ---------- Pipeline stages ----------
  app.get("/settings/stages", async (): Promise<{ stages: StageAdminDTO[] }> => {
    const [rows, counts] = await Promise.all([
      app.db.select().from(pipelineStages).where(isNull(pipelineStages.archivedAt)).orderBy(asc(pipelineStages.position)),
      leadCounts(app.db, leads.stageId),
    ]);
    return { stages: rows.map((s) => ({ id: s.id, name: s.name, color: s.color, kind: s.kind, position: s.position, leadCount: counts.get(s.id) ?? 0 })) };
  });

  app.post("/stages", { preHandler: requireAdmin }, async (request, reply) => {
    const input = stageInput.parse(request.body);
    await assertUniqueName(pipelineStages, input.name);
    const row = await app.db.transaction(async (tx) => {
      // New open stages go just before Won; renumbering keeps Won/Lost last.
      const [{ value }] = await tx.select({ value: max(pipelineStages.position) }).from(pipelineStages).where(and(eq(pipelineStages.kind, "open"), isNull(pipelineStages.archivedAt)));
      const [created] = await tx.insert(pipelineStages).values({ ...input, kind: "open", position: (value ?? -1) + 1 }).returning();
      await renumberStages(tx);
      return created;
    });
    return reply.status(201).send({ stage: { id: row.id, name: row.name, color: row.color, kind: row.kind } });
  });

  app.patch("/stages/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParam.parse(request.params);
    const changes = stageUpdate.parse(request.body);
    if (changes.name) await assertUniqueName(pipelineStages, changes.name, id);
    const [row] = Object.keys(changes).length
      ? await app.db.update(pipelineStages).set(changes).where(and(eq(pipelineStages.id, id), isNull(pipelineStages.archivedAt))).returning()
      : await app.db.select().from(pipelineStages).where(eq(pipelineStages.id, id)).limit(1);
    if (!row) throw httpError(404, "not_found", "Stage not found.");
    return { stage: { id: row.id, name: row.name, color: row.color, kind: row.kind } };
  });

  /** Reorders the open stages; Won and Lost always stay at the end. */
  app.put("/stages/order", { preHandler: requireAdmin }, async (request, reply) => {
    const { ids } = reorderInput.parse(request.body);
    const open = await app.db.select({ id: pipelineStages.id }).from(pipelineStages).where(and(eq(pipelineStages.kind, "open"), isNull(pipelineStages.archivedAt)));
    const openIds = new Set(open.map((s) => s.id));
    if (ids.length !== openIds.size || !ids.every((id) => openIds.has(id))) {
      throw fieldError({ ids: ["Send every open stage exactly once. Won and Lost can't be reordered."] });
    }
    await app.db.transaction(async (tx) => {
      for (const [position, id] of ids.entries()) await tx.update(pipelineStages).set({ position }).where(eq(pipelineStages.id, id));
      await renumberStages(tx);
    });
    return reply.status(204).send();
  });

  /**
   * Removes an open stage. Its leads move to `moveToStageId` (recorded in stage history),
   * then the stage is archived so past history still shows its name.
   */
  app.post("/stages/:id/remove", { preHandler: requireAdmin }, async (request, reply) => {
    const me = currentUser(request);
    const { id } = idParam.parse(request.params);
    const { moveToStageId } = stageRemoveInput.parse(request.body ?? {});
    const active = await app.db.select().from(pipelineStages).where(isNull(pipelineStages.archivedAt));
    const stage = active.find((s) => s.id === id);
    if (!stage) throw httpError(404, "not_found", "Stage not found.");
    if (stage.kind !== "open") throw httpError(409, "required_stage", "The Won and Lost stages are required and can't be removed.");
    if (active.filter((s) => s.kind === "open").length <= 1) throw httpError(409, "last_open_stage", "The pipeline needs at least one open stage.");

    const stageLeads = await app.db.select({ id: leads.id }).from(leads).where(and(eq(leads.stageId, id), isNull(leads.deletedAt)));
    let target: (typeof active)[number] | undefined;
    if (stageLeads.length) {
      target = active.find((s) => s.id === moveToStageId);
      if (!target || target.id === id || target.kind !== "open") {
        throw fieldError({ moveToStageId: [`Choose another open stage for the ${stageLeads.length} lead${stageLeads.length === 1 ? "" : "s"} in ${stage.name}.`] });
      }
    }

    await app.db.transaction(async (tx) => {
      if (target && stageLeads.length) {
        const [{ value }] = await tx.select({ value: max(leads.position) }).from(leads).where(and(eq(leads.stageId, target.id), isNull(leads.deletedAt)));
        const now = new Date();
        for (const [i, lead] of stageLeads.entries()) {
          await tx.update(leads).set({ stageId: target.id, position: (value ?? -1) + 1 + i }).where(eq(leads.id, lead.id));
        }
        await tx.insert(stageChanges).values(stageLeads.map((l) => ({ leadId: l.id, fromStageId: id, toStageId: target!.id, changedBy: me.id, changedAt: now })));
        for (const lead of stageLeads) {
          await recordEvent(tx, { type: "lead.stage_changed", actorId: me.id, leadId: lead.id, payload: { from: stage.name, to: target.name, reason: "stage_removed" } });
        }
      }
      // Soft-deleted leads can stay pointing at the archived stage.
      await tx.update(pipelineStages).set({ archivedAt: new Date() }).where(eq(pipelineStages.id, id));
      await renumberStages(tx);
    });
    return reply.status(204).send();
  });

  // ---------- Tags ----------
  app.get("/settings/tags", async (): Promise<{ tags: TagAdminDTO[] }> => {
    const rows = await app.db
      .select({ id: tags.id, name: tags.name, color: tags.color, n: sql<number>`count(${leads.id})::int` })
      .from(tags)
      .leftJoin(leadTags, eq(leadTags.tagId, tags.id))
      .leftJoin(leads, and(eq(leads.id, leadTags.leadId), isNull(leads.deletedAt)))
      .groupBy(tags.id)
      .orderBy(asc(tags.name));
    return { tags: rows.map(({ n, ...t }) => ({ ...t, leadCount: n })) };
  });

  app.patch("/tags/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParam.parse(request.params);
    const changes = tagUpdate.parse(request.body);
    if (changes.name) {
      const [dup] = await app.db.select({ id: tags.id }).from(tags).where(and(eq(sql`lower(${tags.name})`, changes.name.toLowerCase()), ne(tags.id, id))).limit(1);
      if (dup) throw fieldError({ name: [`“${changes.name}” already exists. Merge the tags instead.`] });
    }
    const [row] = Object.keys(changes).length
      ? await app.db.update(tags).set(changes).where(eq(tags.id, id)).returning()
      : await app.db.select().from(tags).where(eq(tags.id, id)).limit(1);
    if (!row) throw httpError(404, "not_found", "Tag not found.");
    return { tag: { id: row.id, name: row.name, color: row.color } };
  });

  app.delete("/tags/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    await app.db.delete(tags).where(eq(tags.id, id)); // lead_tags rows cascade
    return reply.status(204).send();
  });

  /** Moves every lead from this tag onto `intoId`, then deletes this tag. */
  app.post("/tags/:id/merge", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { intoId } = tagMergeInput.parse(request.body);
    if (intoId === id) throw fieldError({ intoId: ["Choose a different tag to merge into."] });
    const found = await app.db.select({ id: tags.id }).from(tags).where(inArray(tags.id, [id, intoId]));
    if (found.length !== 2) throw httpError(404, "not_found", "Tag not found.");
    await app.db.transaction(async (tx) => {
      const already = tx.select({ leadId: leadTags.leadId }).from(leadTags).where(eq(leadTags.tagId, intoId));
      await tx.update(leadTags).set({ tagId: intoId }).where(and(eq(leadTags.tagId, id), notInArray(leadTags.leadId, already)));
      await tx.delete(tags).where(eq(tags.id, id));
    });
    return reply.status(204).send();
  });
};

export default settingsRoutes;
