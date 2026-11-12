import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ACTIVITY_TYPES,
  COLORS,
  DEAL_SIZES,
  EVENT_TYPES,
  LEAD_INTENTS,
  LOST_REASONS,
  PROJECT_TYPES,
  ROLES,
  STAGE_KINDS,
  TEMPERATURES,
  USER_STATUSES,
} from "@crm/shared";

// ---------- Enums (values come from @crm/shared so API and DB never drift) ----------
export const roleEnum = pgEnum("role", ROLES);
export const temperatureEnum = pgEnum("temperature", TEMPERATURES);
export const stageKindEnum = pgEnum("stage_kind", STAGE_KINDS);
export const projectTypeEnum = pgEnum("project_type", PROJECT_TYPES);
export const leadIntentEnum = pgEnum("lead_intent", LEAD_INTENTS);
export const dealSizeEnum = pgEnum("deal_size", DEAL_SIZES);
export const activityTypeEnum = pgEnum("activity_type", ACTIVITY_TYPES);
export const lostReasonEnum = pgEnum("lost_reason", LOST_REASONS);
export const userStatusEnum = pgEnum("user_status", USER_STATUSES);
export const eventTypeEnum = pgEnum("event_type", EVENT_TYPES);
export const colorEnum = pgEnum("color", COLORS);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---------- Workspace (single team; one row) ----------
export const workspace = pgTable("workspace", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("USD"),
  timezone: text("timezone").notNull().default("UTC"),
  updatedAt: updatedAt(),
});

// ---------- People & auth ----------
export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    role: roleEnum("role").notNull().default("member"),
    avatarColor: colorEnum("avatar_color").notNull().default("violet"),
    status: userStatusEnum("status").notNull().default("active"),
    lastSeenAt: ts("last_seen_at"),
    deactivatedAt: ts("deactivated_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the cookie token; the raw token is never stored. */
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const invitations = pgTable("invitations", {
  id: id(),
  email: text("email").notNull(),
  role: roleEnum("role").notNull().default("member"),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: ts("expires_at").notNull(),
  acceptedAt: ts("accepted_at"),
  createdAt: createdAt(),
});

export const passwordResets = pgTable("password_resets", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

// ---------- Configuration ----------
export const leadSources = pgTable(
  "lead_sources",
  {
    id: id(),
    name: text("name").notNull(),
    color: colorEnum("color").notNull().default("gray"),
    position: integer("position").notNull().default(0),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
  },
  // Names are unique among active sources; an archived name can be reused.
  (t) => [uniqueIndex("lead_sources_active_name_unique").on(sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`)],
);

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: id(),
    name: text("name").notNull(),
    color: colorEnum("color").notNull().default("gray"),
    kind: stageKindEnum("kind").notNull().default("open"),
    position: integer("position").notNull().default(0),
    /** Removed stages are archived, not deleted, so stage history keeps pointing at them. */
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pipeline_stages_active_name_unique").on(sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`)],
);

export const tags = pgTable(
  "tags",
  {
    id: id(),
    name: text("name").notNull(),
    color: colorEnum("color").notNull().default("gray"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tags_name_unique").on(sql`lower(${t.name})`)],
);

export const goals = pgTable("goals", {
  /** Month in YYYY-MM form. */
  month: text("month").primaryKey(),
  targetCents: bigint("target_cents", { mode: "number" }).notNull(),
  updatedAt: updatedAt(),
});

// ---------- Leads ----------
export const leads = pgTable(
  "leads",
  {
    id: id(),
    fullName: text("full_name").notNull(),
    company: text("company"),
    jobTitle: text("job_title"),
    email: text("email"),
    phone: text("phone"),
    location: text("location"),
    sourceId: uuid("source_id").references(() => leadSources.id, { onDelete: "set null" }),
    leadType: text("lead_type"),
    projectType: projectTypeEnum("project_type"),
    temperature: temperatureEnum("temperature").notNull().default("warm"),
    stageId: uuid("stage_id").notNull().references(() => pipelineStages.id),
    /** Order within the stage's kanban column. */
    position: integer("position").notNull().default(0),
    intent: leadIntentEnum("intent"),
    valueCents: bigint("value_cents", { mode: "number" }),
    dealSize: dealSizeEnum("deal_size"),
    expectedClose: date("expected_close"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    nextFollowupAt: ts("next_followup_at"),
    pinnedNote: text("pinned_note"),
    pinnedBy: uuid("pinned_by").references(() => users.id, { onDelete: "set null" }),
    pinnedAt: ts("pinned_at"),
    wonAt: ts("won_at"),
    lostAt: ts("lost_at"),
    lostReason: lostReasonEnum("lost_reason"),
    lostNotes: text("lost_notes"),
    lastActivityAt: ts("last_activity_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("leads_stage_position_idx").on(t.stageId, t.position),
    index("leads_owner_idx").on(t.ownerId),
    index("leads_source_idx").on(t.sourceId),
    index("leads_followup_idx").on(t.nextFollowupAt),
    index("leads_created_idx").on(t.createdAt),
    index("leads_email_idx").on(sql`lower(${t.email})`),
    // Trigram indexes make ILIKE "%term%" search fast (requires the pg_trgm extension; see migration 0002).
    index("leads_full_name_trgm_idx").using("gin", sql`${t.fullName} gin_trgm_ops`),
    index("leads_company_trgm_idx").using("gin", sql`${t.company} gin_trgm_ops`),
    index("leads_email_trgm_idx").using("gin", sql`${t.email} gin_trgm_ops`),
  ],
);

export const leadTags = pgTable(
  "lead_tags",
  {
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.leadId, t.tagId] }), index("lead_tags_tag_idx").on(t.tagId)],
);

export const activities = pgTable(
  "activities",
  {
    id: id(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    type: activityTypeEnum("type").notNull(),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    title: text("title").notNull(),
    body: text("body"),
    nextStep: text("next_step"),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("activities_lead_idx").on(t.leadId, t.occurredAt)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    title: text("title").notNull(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    assigneeId: uuid("assignee_id").notNull().references(() => users.id),
    dueAt: ts("due_at"),
    completedAt: ts("completed_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_assignee_due_idx").on(t.assigneeId, t.dueAt), index("tasks_lead_idx").on(t.leadId)],
);

export const documents = pgTable(
  "documents",
  {
    id: id(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    mimeType: text("mime_type").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    /** Public share link token (hashed); null until shared. */
    shareTokenHash: text("share_token_hash").unique(),
    shareExpiresAt: ts("share_expires_at"),
    sentAt: ts("sent_at"),
    firstViewedAt: ts("first_viewed_at"),
    lastViewedAt: ts("last_viewed_at"),
    viewCount: integer("view_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("documents_lead_idx").on(t.leadId)],
);

export const stageChanges = pgTable(
  "stage_changes",
  {
    id: id(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    fromStageId: uuid("from_stage_id").references(() => pipelineStages.id, { onDelete: "set null" }),
    toStageId: uuid("to_stage_id").notNull().references(() => pipelineStages.id),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    changedAt: ts("changed_at").notNull().defaultNow(),
  },
  (t) => [index("stage_changes_lead_idx").on(t.leadId, t.changedAt)],
);

/**
 * Field-level change history for leads (who changed what, from what, to what).
 * Stage moves live in stage_changes; together they make a lead's History tab.
 * Values are stored as display text captured at the time (e.g. the owner's name), so the
 * history still reads correctly after people, sources or tags are renamed or removed.
 */
export const leadChanges = pgTable(
  "lead_changes",
  {
    id: id(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    /** "updated" (field edits) or "deleted". */
    action: text("action").notNull(),
    changes: jsonb("changes").$type<{ field: string; from: string | null; to: string | null }[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("lead_changes_lead_idx").on(t.leadId, t.createdAt)],
);

// ---------- Feed, audit & notifications ----------
export const events = pgTable(
  "events",
  {
    id: id(),
    type: eventTypeEnum("type").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("events_created_idx").on(t.createdAt), index("events_lead_idx").on(t.leadId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt), uniqueIndex("notifications_user_event_unique").on(t.userId, t.eventId)],
);

export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventType: eventTypeEnum("event_type").notNull(),
    email: boolean("email").notNull().default(true),
    inApp: boolean("in_app").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventType] })],
);

// ---------- Shared counters (work across several API instances, e.g. serverless) ----------

/** Fixed-window request counters for @fastify/rate-limit (see lib/rateLimitStore.ts). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

/** Failed sign-ins per email (see lib/loginThrottle.ts). */
export const loginThrottle = pgTable("login_throttle", {
  email: text("email").primaryKey(),
  failures: integer("failures").notNull(),
  firstAt: timestamp("first_at", { withTimezone: true }).notNull(),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
});

/** Last run of each background job, so only one instance runs it per interval (see jobs.ts). */
export const jobRuns = pgTable("job_runs", {
  name: text("name").primaryKey(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
});

/**
 * Errors from the API and from browsers, grouped by fingerprint (same source, message and
 * route) so a repeating error counts up instead of filling the table. Admins see them on
 * Settings → System status and get a "system.error" notification when one is new.
 */
export const appErrors = pgTable(
  "app_errors",
  {
    id: id(),
    fingerprint: text("fingerprint").notNull().unique(),
    /** "server" or "client". */
    source: text("source").notNull(),
    message: text("message").notNull(),
    stack: text("stack"),
    method: text("method"),
    path: text("path"),
    status: integer("status"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    count: integer("count").notNull().default(1),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    /** When an admin last told admins about it (alerts repeat at most hourly while it keeps happening). */
    alertedAt: ts("alerted_at"),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [index("app_errors_last_seen_idx").on(t.lastSeenAt)],
);
