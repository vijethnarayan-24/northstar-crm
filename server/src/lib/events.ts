import { and, eq, inArray, isNull } from "drizzle-orm";
import { NOTIFICATION_CATEGORIES, type EventType } from "@crm/shared";
import { schema, type Database } from "../db/client";

type Db = Pick<Database, "insert" | "select">;
type EventRow = typeof schema.events.$inferSelect;
const { events, notifications, notificationPrefs, leads, users } = schema;

export interface NewEvent {
  type: EventType;
  actorId: string | null;
  leadId?: string | null;
  subjectId?: string | null;
  payload?: Record<string, unknown>;
}

/** Which notification category (and so which preference) an event type belongs to. */
const categoryOf = new Map<EventType, string>(NOTIFICATION_CATEGORIES.flatMap((c) => c.types.map((t) => [t as EventType, c.key] as const)));
/** Event types whose notification goes to the lead's owner. */
const TO_LEAD_OWNER = new Set<EventType>(["lead.stage_changed", "lead.won", "lead.lost", "activity.logged", "note.pinned", "document.uploaded", "document.viewed", "followup.due"]);

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Everyone who should hear about this event (before preferences), never the actor. */
async function recipientsFor(db: Db, e: EventRow): Promise<string[]> {
  const ids = new Set<string>();
  if (e.type === "lead.assigned" && e.subjectId) ids.add(e.subjectId);
  if (e.type === "task.created" || e.type === "task.due") {
    const assignee = str(e.payload.assigneeId);
    if (assignee) ids.add(assignee);
  }
  if (e.type === "document.viewed") {
    const uploader = str(e.payload.uploaderId);
    if (uploader) ids.add(uploader);
  }
  if (TO_LEAD_OWNER.has(e.type) && e.leadId) {
    const [lead] = await db.select({ ownerId: leads.ownerId }).from(leads).where(eq(leads.id, e.leadId)).limit(1);
    if (lead?.ownerId) ids.add(lead.ownerId);
  }
  if (e.type === "system.error") {
    for (const admin of await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), isNull(users.deactivatedAt)))) ids.add(admin.id);
  }
  if (e.actorId) ids.delete(e.actorId);
  return [...ids];
}

async function notifyFor(db: Db, e: EventRow) {
  const category = categoryOf.get(e.type);
  if (!category) return;
  const candidates = await recipientsFor(db, e);
  if (!candidates.length) return;
  const category_ = NOTIFICATION_CATEGORIES.find((c) => c.key === category)!;
  const [active, optedOut] = await Promise.all([
    db.select({ id: users.id }).from(users).where(and(inArray(users.id, candidates), isNull(users.deactivatedAt))),
    // A preference row with inApp=false for any type in the category turns the category off.
    db
      .select({ userId: notificationPrefs.userId })
      .from(notificationPrefs)
      .where(and(inArray(notificationPrefs.userId, candidates), inArray(notificationPrefs.eventType, [...category_.types] as EventType[]), eq(notificationPrefs.inApp, false))),
  ]);
  const off = new Set(optedOut.map((r) => r.userId));
  const recipients = active.map((u) => u.id).filter((id) => !off.has(id));
  if (recipients.length) {
    await db.insert(notifications).values(recipients.map((userId) => ({ userId, eventId: e.id }))).onConflictDoNothing();
  }
}

/** Appends to the activity feed / audit log and notifies the people it concerns. Pass the transaction when inside one. */
export async function recordEvent(db: Db, event: NewEvent) {
  const [row] = await db.insert(events).values({ ...event, payload: event.payload ?? {} }).returning();
  await notifyFor(db, row!);
  return row!;
}
