import { and, asc, count, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { leadListQuery, type LeadDetailDTO, type LeadListItemDTO, type StageRef, type TagRef, type UserRef } from "@crm/shared";
import type { z } from "zod";
import { schema, type Database } from "../db/client";
import { endOfTodaySql } from "../lib/time";
import { canDeleteLead, canEditLead } from "./policy";

const { leads, pipelineStages, leadSources, users, tags, leadTags, tasks, documents, workspace } = schema;
export const ownerUser = alias(users, "owner");
const pinnedByUser = alias(users, "pinned_by_user");
const createdByUser = alias(users, "created_by_user");

type LeadRow = typeof leads.$inferSelect;
type UserRow = typeof users.$inferSelect;
type ParsedListQuery = z.output<typeof leadListQuery>;

const iso = (d: Date | null) => d?.toISOString() ?? null;
export const toUserRef = (u: { id: string; name: string; avatarColor: UserRow["avatarColor"] } | null): UserRef | null =>
  u ? { id: u.id, name: u.name, avatarColor: u.avatarColor } : null;
export const toStageRef = (s: typeof pipelineStages.$inferSelect): StageRef => ({ id: s.id, name: s.name, color: s.color, kind: s.kind, position: s.position });

const baseSelect = { lead: leads, stage: pipelineStages, source: leadSources, owner: ownerUser };

const fromLeads = (db: Database) =>
  db
    .select(baseSelect)
    .from(leads)
    .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .leftJoin(ownerUser, eq(ownerUser.id, leads.ownerId));

async function tagsFor(db: Database, leadIds: string[]) {
  const byLead = new Map<string, TagRef[]>();
  if (!leadIds.length) return byLead;
  const rows = await db
    .select({ leadId: leadTags.leadId, id: tags.id, name: tags.name, color: tags.color })
    .from(leadTags)
    .innerJoin(tags, eq(tags.id, leadTags.tagId))
    .where(inArray(leadTags.leadId, leadIds))
    .orderBy(asc(tags.name));
  for (const { leadId, ...tag } of rows) byLead.set(leadId, [...(byLead.get(leadId) ?? []), tag]);
  return byLead;
}

type BaseRow = { lead: LeadRow; stage: typeof pipelineStages.$inferSelect; source: typeof leadSources.$inferSelect | null; owner: UserRow | null };

const toListItem = (r: BaseRow, tagList: TagRef[], viewer: UserRow): LeadListItemDTO => ({
  id: r.lead.id,
  fullName: r.lead.fullName,
  company: r.lead.company,
  jobTitle: r.lead.jobTitle,
  email: r.lead.email,
  leadType: r.lead.leadType,
  temperature: r.lead.temperature,
  valueCents: r.lead.valueCents,
  source: r.source ? { id: r.source.id, name: r.source.name, color: r.source.color } : null,
  stage: toStageRef(r.stage),
  position: r.lead.position,
  owner: toUserRef(r.owner),
  tags: tagList,
  pinnedNote: r.lead.pinnedNote,
  lastActivityAt: iso(r.lead.lastActivityAt),
  nextFollowupAt: iso(r.lead.nextFollowupAt),
  createdAt: r.lead.createdAt.toISOString(),
  canEdit: canEditLead(viewer, r.lead),
  canDelete: canDeleteLead(viewer, r.lead),
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);


export async function buildLeadFilters(db: Database, q: ParsedListQuery): Promise<SQL[]> {
  const where: SQL[] = [isNull(leads.deletedAt)];
  if (q.q) {
    const term = `%${escapeLike(q.q)}%`;
    where.push(or(ilike(leads.fullName, term), ilike(leads.company, term), ilike(leads.email, term))!);
  }
  if (q.sourceId?.length) where.push(inArray(leads.sourceId, q.sourceId));
  if (q.stageId?.length) where.push(inArray(leads.stageId, q.stageId));
  if (q.temperature?.length) where.push(inArray(leads.temperature, q.temperature));
  if (q.leadType?.length) where.push(inArray(leads.leadType, q.leadType));
  if (q.ownerId?.length) where.push(inArray(leads.ownerId, q.ownerId));
  if (q.tagId?.length) where.push(inArray(leads.id, db.select({ id: leadTags.leadId }).from(leadTags).where(inArray(leadTags.tagId, q.tagId))));
  if (q.followup) {
    if (q.followup === "none") where.push(isNull(leads.nextFollowupAt));
    else {
      // Follow-ups only matter while the deal is still open.
      where.push(eq(pipelineStages.kind, "open"), isNotNull(leads.nextFollowupAt));
      if (q.followup === "overdue") where.push(lt(leads.nextFollowupAt, sql`now()`));
      if (q.followup === "upcoming") where.push(gte(leads.nextFollowupAt, sql`now()`));
      if (q.followup === "today") where.push(gte(leads.nextFollowupAt, sql`now()`), lt(leads.nextFollowupAt, await endOfTodaySql(db)));
    }
  }
  return where;
}

const sortColumns = {
  createdAt: leads.createdAt,
  fullName: leads.fullName,
  valueCents: leads.valueCents,
  lastActivityAt: leads.lastActivityAt,
  nextFollowupAt: leads.nextFollowupAt,
} as const;

export async function listLeads(db: Database, q: ParsedListQuery, viewer: UserRow) {
  const where = and(...(await buildLeadFilters(db, q)));
  const column = sortColumns[q.sort];
  const order = q.dir === "asc" ? sql`${column} asc nulls last` : sql`${column} desc nulls last`;
  const [rows, [{ total }]] = await Promise.all([
    fromLeads(db).where(where).orderBy(order, asc(leads.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(leads).innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId)).where(where),
  ]);
  const tagMap = await tagsFor(db, rows.map((r) => r.lead.id));
  return { items: rows.map((r) => toListItem(r, tagMap.get(r.lead.id) ?? [], viewer)), total, page: q.page, pageSize: q.pageSize };
}

type BoardQuery = { ownerId?: string[]; sourceId?: string[]; closedWithinDays: number };

/** Which leads belong on the board: open deals, plus won/lost deals closed in the last `closedWithinDays`. */
function boardWhere(q: BoardQuery) {
  const since = sql`now() - make_interval(days => ${q.closedWithinDays})`;
  return and(
    isNull(leads.deletedAt),
    isNull(pipelineStages.archivedAt),
    q.ownerId?.length ? inArray(leads.ownerId, q.ownerId) : undefined,
    q.sourceId?.length ? inArray(leads.sourceId, q.sourceId) : undefined,
    or(
      eq(pipelineStages.kind, "open"),
      and(eq(pipelineStages.kind, "won"), gte(sql`coalesce(${leads.wonAt}, ${leads.updatedAt})`, since)),
      and(eq(pipelineStages.kind, "lost"), gte(sql`coalesce(${leads.lostAt}, ${leads.updatedAt})`, since)),
    ),
  );
}

/**
 * Board data per stage: the first `perColumn` cards in card order, plus the full count and
 * value of the column (so totals stay right when a column is truncated).
 */
export async function listBoard(db: Database, q: BoardQuery & { perColumn: number }, stageIds: string[], viewer: UserRow) {
  const where = boardWhere(q);
  const [totals, ...columns] = await Promise.all([
    db
      .select({ stageId: leads.stageId, n: count(), value: sql<number>`coalesce(sum(${leads.valueCents}), 0)::float8`.mapWith(Number) })
      .from(leads)
      .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
      .where(where)
      .groupBy(leads.stageId),
    ...stageIds.map((stageId) => fromLeads(db).where(and(where, eq(leads.stageId, stageId))).orderBy(asc(leads.position), asc(leads.createdAt)).limit(q.perColumn)),
  ]);
  const rows = columns.flat();
  const tagMap = await tagsFor(db, rows.map((r) => r.lead.id));
  const byStage = new Map(totals.map((t) => [t.stageId, t]));
  return stageIds.map((stageId, i) => ({
    stageId,
    leads: columns[i]!.map((r) => toListItem(r, tagMap.get(r.lead.id) ?? [], viewer)),
    count: byStage.get(stageId)?.n ?? 0,
    totalCents: byStage.get(stageId)?.value ?? 0,
  }));
}

export async function getLeadRow(db: Database, id: string) {
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), isNull(leads.deletedAt))).limit(1);
  return lead ?? null;
}

export async function getLeadDetail(db: Database, id: string, viewer: UserRow): Promise<LeadDetailDTO | null> {
  const [row] = await db
    .select({ ...baseSelect, pinnedBy: pinnedByUser, createdBy: createdByUser })
    .from(leads)
    .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .leftJoin(ownerUser, eq(ownerUser.id, leads.ownerId))
    .leftJoin(pinnedByUser, eq(pinnedByUser.id, leads.pinnedBy))
    .leftJoin(createdByUser, eq(createdByUser.id, leads.createdBy))
    .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
    .limit(1);
  if (!row) return null;
  const [tagMap, [{ openTasks }], [{ docs }]] = await Promise.all([
    tagsFor(db, [id]),
    db.select({ openTasks: count() }).from(tasks).where(and(eq(tasks.leadId, id), isNull(tasks.completedAt))),
    db.select({ docs: count() }).from(documents).where(eq(documents.leadId, id)),
  ]);
  const l = row.lead;
  return {
    ...toListItem(row, tagMap.get(id) ?? [], viewer),
    phone: l.phone,
    location: l.location,
    projectType: l.projectType,
    intent: l.intent,
    dealSize: l.dealSize,
    expectedClose: l.expectedClose,
    pinnedBy: toUserRef(row.pinnedBy),
    pinnedAt: iso(l.pinnedAt),
    wonAt: iso(l.wonAt),
    lostAt: iso(l.lostAt),
    lostReason: l.lostReason,
    lostNotes: l.lostNotes,
    createdBy: toUserRef(row.createdBy),
    updatedAt: l.updatedAt.toISOString(),
    counts: { openTasks, documents: docs },
  };
}
