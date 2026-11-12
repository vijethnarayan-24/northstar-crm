import { eq, inArray } from "drizzle-orm";
import { schema, type Database } from "../db/client";

const { leads, leadTags, leadSources, users, tags, leadChanges } = schema;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type LeadRow = typeof leads.$inferSelect;
type LeadSet = Partial<typeof leads.$inferInsert>;
export interface FieldChange { field: string; from: string | null; to: string | null }

/** Lead fields whose edits are recorded (internal columns like position or timestamps are not). */
const TRACKED = [
  "fullName", "company", "jobTitle", "email", "phone", "location", "sourceId", "leadType", "projectType",
  "temperature", "intent", "valueCents", "dealSize", "expectedClose", "ownerId", "nextFollowupAt", "pinnedNote",
] as const;

const text = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

/** Names for ids, captured now so history survives later renames and deletions. */
async function names(tx: Tx | Database, table: typeof users | typeof leadSources, ids: (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (!wanted.length) return new Map<string, string>();
  const rows = await tx.select({ id: table.id, name: table.name }).from(table).where(inArray(table.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Compares a lead before an update with the values being written and returns one entry per
 * changed field, with readable values (names instead of ids). Tags compare as a set.
 */
export async function diffLead(tx: Tx | Database, before: LeadRow, set: LeadSet, tagIds?: string[]): Promise<FieldChange[]> {
  const changes: FieldChange[] = [];
  const owners = await names(tx, users, [before.ownerId, set.ownerId as string | null | undefined]);
  const sources = await names(tx, leadSources, [before.sourceId, set.sourceId as string | null | undefined]);

  for (const field of TRACKED) {
    if (!(field in set)) continue;
    const from = text(before[field]);
    const to = text(set[field]);
    if (from === to) continue;
    if (field === "ownerId") changes.push({ field: "owner", from: from && (owners.get(from) ?? "Removed user"), to: to && (owners.get(to) ?? "Removed user") });
    else if (field === "sourceId") changes.push({ field: "source", from: from && (sources.get(from) ?? "Removed source"), to: to && (sources.get(to) ?? "Removed source") });
    else changes.push({ field, from, to });
  }

  if (tagIds) {
    const current = await tx.select({ id: leadTags.tagId }).from(leadTags).where(eq(leadTags.leadId, before.id));
    const was = new Set(current.map((t) => t.id));
    const now = new Set(tagIds);
    if (was.size !== now.size || [...now].some((id) => !was.has(id))) {
      const all = [...new Set([...was, ...now])];
      const tagNames = all.length ? new Map((await tx.select({ id: tags.id, name: tags.name }).from(tags).where(inArray(tags.id, all))).map((t) => [t.id, t.name])) : new Map<string, string>();
      const label = (ids: Set<string>) => (ids.size ? [...ids].map((id) => tagNames.get(id) ?? "Removed tag").sort().join(", ") : null);
      changes.push({ field: "tags", from: label(was), to: label(now) });
    }
  }
  return changes;
}

export async function recordLeadChange(tx: Tx | Database, entry: { leadId: string; actorId: string | null; action: "updated" | "deleted"; changes?: FieldChange[] }) {
  if (entry.action === "updated" && !entry.changes?.length) return;
  await tx.insert(leadChanges).values({ leadId: entry.leadId, actorId: entry.actorId, action: entry.action, changes: entry.changes ?? [] });
}
