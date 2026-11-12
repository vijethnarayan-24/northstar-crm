import { z } from "zod";
import {
  activityTypeSchema,
  colorSchema,
  eventTypeSchema,
  userStatusSchema,
  type ActivityType,
  type EventType,
  type Color,
  type DealSize,
  type LeadIntent,
  type LostReason,
  type ProjectType,
  type Role,
  type StageKind,
  type Temperature,
  type UserStatus,
  dealSizeSchema,
  leadIntentSchema,
  lostReasonSchema,
  projectTypeSchema,
  roleSchema,
  stageKindSchema,
  temperatureSchema,
} from "./enums";

const id = z.uuid();
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
/** Money is stored and sent as integer cents to avoid float rounding. */
const cents = z.number().int().nonnegative();
const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });

// ---------- Auth ----------
export const loginInput = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInput>;

export const acceptInviteInput = z.object({
  token: z.string().min(20),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12, "Use at least 12 characters").max(200),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteInput>;

export const PASSWORD_MIN = 12;
const newPassword = z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`).max(200);

export const forgotPasswordInput = z.object({ email: z.email().toLowerCase() });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInput>;

export const resetPasswordInput = z.object({ token: z.string().min(20), password: newPassword });
export type ResetPasswordInput = z.infer<typeof resetPasswordInput>;

export const changePasswordInput = z.object({ currentPassword: z.string().min(1), newPassword });
export type ChangePasswordInput = z.infer<typeof changePasswordInput>;

export const profileUpdate = z.object({
  name: z.string().trim().min(1, "Name is required").max(120).optional(),
  avatarColor: colorSchema.optional(),
  status: userStatusSchema.optional(),
});
export type ProfileUpdate = z.infer<typeof profileUpdate>;

/** Admin-only changes to another member. */
export const memberUpdate = z.object({
  role: roleSchema.optional(),
  active: z.boolean().optional(),
});
export type MemberUpdate = z.infer<typeof memberUpdate>;

/** User as returned by the API (never includes the password hash). */
export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarColor: Color;
  status: UserStatus;
  active: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface InvitationDTO {
  id: string;
  email: string;
  role: Role;
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface InviteCreatedDTO {
  invitation: InvitationDTO;
  /** Shareable accept link, so admins can send it themselves until email is configured. */
  inviteUrl: string;
}

export interface ApiErrorBody {
  error: string;
  message?: string;
  issues?: Record<string, string[] | undefined>;
}

// ---------- Leads ----------
/** Blank strings from forms are stored as null. */
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const nullableText = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const nullable = <T extends z.ZodType>(schema: T) => z.preprocess(blankToNull, schema.nullable().optional());

const leadFields = z.object({
  fullName: z.string().trim().min(1, "Full name is required").max(160),
  company: nullableText(160),
  jobTitle: nullableText(120),
  email: nullable(z.email("Enter a valid email").toLowerCase()),
  phone: nullableText(40),
  location: nullableText(160),
  sourceId: nullable(id),
  leadType: nullableText(80),
  projectType: nullable(projectTypeSchema),
  temperature: temperatureSchema,
  intent: nullable(leadIntentSchema),
  valueCents: nullable(cents),
  dealSize: nullable(dealSizeSchema),
  expectedClose: nullable(isoDate),
  ownerId: nullable(id),
  nextFollowupAt: nullable(isoDateTime),
  tagIds: z.array(id).max(30).optional(),
  pinnedNote: nullableText(2000),
});

export const leadInput = leadFields.extend({
  temperature: temperatureSchema.default("warm"),
  /** Defaults to the first open stage. */
  stageId: id.optional(),
  /** Create even if another lead already uses this email. */
  allowDuplicate: z.boolean().optional(),
});
export type LeadInput = z.input<typeof leadInput>;

/** Stage changes go through POST /leads/:id/move so history and won/lost stay consistent. */
export const leadUpdate = leadFields.partial().extend({ allowDuplicate: z.boolean().optional() });
export type LeadUpdate = z.input<typeof leadUpdate>;

export const LEAD_SORT_FIELDS = ["createdAt", "fullName", "valueCents", "lastActivityAt", "nextFollowupAt"] as const;
export type LeadSortField = (typeof LEAD_SORT_FIELDS)[number];
export const FOLLOWUP_FILTERS = ["overdue", "today", "upcoming", "none"] as const;

/** Accepts `?a=1&a=2` and `?a=1,2`. */
const list = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined || v === "" ? undefined : (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(",")).filter(Boolean)), z.array(item).optional());

export const leadListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  sourceId: list(id),
  stageId: list(id),
  temperature: list(temperatureSchema),
  leadType: list(z.string().max(80)),
  ownerId: list(id),
  tagId: list(id),
  followup: z.enum(FOLLOWUP_FILTERS).optional(),
  sort: z.enum(LEAD_SORT_FIELDS).default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type LeadListQuery = z.input<typeof leadListQuery>;

export const moveLeadInput = z.object({
  stageId: id,
  /** Index within the target column; omitted means append to the end. */
  position: z.number().int().nonnegative().optional(),
  /** Required when moving to a "lost" stage. */
  lostReason: lostReasonSchema.optional(),
  lostNotes: nullableText(2000),
});
export type MoveLeadInput = z.input<typeof moveLeadInput>;

export const tagCreateInput = z.object({ name: z.string().trim().min(1, "Tag name is required").max(40), color: colorSchema.default("gray") });
export type TagCreateInput = z.input<typeof tagCreateInput>;

// ---------- Lead DTOs ----------
export interface SourceRef { id: string; name: string; color: Color }
export interface StageRef { id: string; name: string; color: Color; kind: StageKind; position: number }
export interface TagRef { id: string; name: string; color: Color }
export interface UserRef { id: string; name: string; avatarColor: Color }

export interface LookupsDTO {
  sources: SourceRef[];
  stages: StageRef[];
  tags: TagRef[];
  /** Active members, for owner pickers. */
  users: UserRef[];
  leadTypes: string[];
}

export interface LeadListItemDTO {
  id: string;
  fullName: string;
  company: string | null;
  jobTitle: string | null;
  email: string | null;
  leadType: string | null;
  temperature: Temperature;
  valueCents: number | null;
  source: SourceRef | null;
  stage: StageRef;
  position: number;
  owner: UserRef | null;
  tags: TagRef[];
  pinnedNote: string | null;
  lastActivityAt: string | null;
  nextFollowupAt: string | null;
  createdAt: string;
  /** Whether the current viewer may edit / delete this lead. */
  canEdit: boolean;
  canDelete: boolean;
}

export interface LeadDetailDTO extends LeadListItemDTO {
  phone: string | null;
  location: string | null;
  projectType: ProjectType | null;
  intent: LeadIntent | null;
  dealSize: DealSize | null;
  expectedClose: string | null;
  pinnedBy: UserRef | null;
  pinnedAt: string | null;
  wonAt: string | null;
  lostAt: string | null;
  lostReason: LostReason | null;
  lostNotes: string | null;
  createdBy: UserRef | null;
  updatedAt: string;
  counts: { openTasks: number; documents: number };
}

export interface Paginated<T> { items: T[]; total: number; page: number; pageSize: number }

export interface ActivityDTO {
  id: string;
  type: ActivityType;
  occurredAt: string;
  title: string;
  body: string | null;
  nextStep: string | null;
  author: UserRef | null;
  /** Author or admin. */
  canEdit: boolean;
}

export interface TaskDTO {
  id: string;
  title: string;
  dueAt: string | null;
  completedAt: string | null;
  assignee: UserRef;
  lead: { id: string; fullName: string; company: string | null; ownerId: string | null } | null;
  createdBy: UserRef | null;
  createdAt: string;
  /** Assignee, creator, the lead owner, or an admin. */
  canEdit: boolean;
}

export interface TaskStatsDTO { overdue: number; dueToday: number; upcoming: number; completedThisWeek: number }
export interface MeSummaryDTO { tasksDue: number }

export interface DocumentDTO {
  id: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  uploadedBy: UserRef | null;
  createdAt: string;
  /** When a share link was last created. */
  sentAt: string | null;
  /** A share link is currently active (not revoked, not expired). */
  shared: boolean;
  shareExpiresAt: string | null;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
  /** Uploader, the lead's owner, or an admin. */
  canManage: boolean;
}

export interface ShareLinkDTO { shareUrl: string; expiresAt: string }
export const shareInput = z.object({ expiresInDays: z.coerce.number().int().min(1).max(365).default(30) });
export type ShareInput = z.input<typeof shareInput>;

/** Step 1 of a direct-to-storage upload (Vercel Blob): ask for a one-file upload token. */
export const uploadStartInput = z.object({ filename: z.string().trim().min(1).max(255), sizeBytes: z.number().int().min(0) });
/** `direct` is null when the server stores files itself; then post multipart to /leads/:id/documents. */
export interface UploadStartDTO { direct: { pathname: string; clientToken: string; contentType: string } | null }
/** Step 2: tell the API the file is in storage so it records the document. */
export const uploadCompleteInput = z.object({ pathname: z.string().min(1).max(500), filename: z.string().trim().min(1).max(255) });

/** File types accepted for upload: extension → MIME type. */
export const ALLOWED_UPLOADS: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
};

export interface StageChangeDTO {
  id: string;
  from: StageRef | null;
  to: StageRef;
  changedBy: UserRef | null;
  changedAt: string;
}

/** One entry on a lead's History tab: a stage move, field edits, or deletion. Newest first. */
export type LeadHistoryEntryDTO =
  | { id: string; kind: "stage"; at: string; by: UserRef | null; from: StageRef | null; to: StageRef }
  | { id: string; kind: "updated"; at: string; by: UserRef | null; changes: { field: string; from: string | null; to: string | null }[] }
  | { id: string; kind: "deleted"; at: string; by: UserRef | null };

export interface PipelineColumnDTO {
  stage: StageRef;
  leads: LeadListItemDTO[];
  /** Leads in the whole column (may exceed leads.length). */
  count: number;
  totalCents: number;
  /** More cards exist than were returned (see perColumn). */
  hasMore: boolean;
}
export interface PipelineDTO { columns: PipelineColumnDTO[]; closedWithinDays: number; perColumn: number }

export interface DuplicateLeadError extends ApiErrorBody {
  error: "duplicate_email";
  lead: { id: string; fullName: string };
}

export const markLostInput = z.object({
  reason: lostReasonSchema,
  notes: optionalText(2000),
});
export type MarkLostInput = z.infer<typeof markLostInput>;

// ---------- Activities ----------
export const activityInput = z.object({
  type: activityTypeSchema,
  /** Defaults to now. */
  occurredAt: nullable(isoDateTime),
  title: z.string().trim().min(1, "Add a short summary").max(200),
  body: nullableText(5000),
  nextStep: nullableText(500),
  /** When set (with nextStep), also creates a task due then and sets the lead's next follow-up. */
  nextStepDueAt: nullable(isoDateTime),
});
export type ActivityInput = z.input<typeof activityInput>;

export const activityUpdate = activityInput.omit({ nextStepDueAt: true }).partial();
export type ActivityUpdate = z.input<typeof activityUpdate>;

// ---------- Tasks ----------
export const taskInput = z.object({
  title: z.string().trim().min(1, "Task title is required").max(200),
  leadId: nullable(id),
  assigneeId: id,
  dueAt: nullable(isoDateTime),
});
export type TaskInput = z.input<typeof taskInput>;

export const taskUpdate = taskInput.partial().extend({ completed: z.boolean().optional() });
export type TaskUpdate = z.input<typeof taskUpdate>;

export const TASK_VIEWS = ["overdue", "today", "upcoming", "completed", "open"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];
const assigneeFilter = z.union([id, z.literal("me")]).optional();
export const taskListQuery = z.object({
  view: z.enum(TASK_VIEWS).default("open"),
  /** A user id, or "me". */
  assigneeId: assigneeFilter,
  leadId: id.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type TaskListQuery = z.input<typeof taskListQuery>;
export const taskStatsQuery = z.object({ assigneeId: assigneeFilter });

// ---------- Settings ----------
const settingName = (max: number, what: string) => z.string().trim().min(1, `${what} name is required`).max(max);

export const sourceInput = z.object({ name: settingName(60, "Source"), color: colorSchema.default("gray") });
export type SourceInput = z.input<typeof sourceInput>;
export const sourceUpdate = z.object({ name: settingName(60, "Source").optional(), color: colorSchema.optional(), archived: z.boolean().optional() });
export type SourceUpdate = z.input<typeof sourceUpdate>;

/** New stages are always open stages; each pipeline has exactly one Won and one Lost stage. */
export const stageInput = z.object({ name: settingName(60, "Stage"), color: colorSchema.default("gray") });
export type StageInput = z.input<typeof stageInput>;
export const stageUpdate = z.object({ name: settingName(60, "Stage").optional(), color: colorSchema.optional() });
export type StageUpdate = z.input<typeof stageUpdate>;
/** Removing a stage that still has leads requires choosing where they go. */
export const stageRemoveInput = z.object({ moveToStageId: id.optional() });
export type StageRemoveInput = z.input<typeof stageRemoveInput>;

export const tagInput = z.object({ name: settingName(40, "Tag"), color: colorSchema.default("gray") });
export const tagUpdate = z.object({ name: settingName(40, "Tag").optional(), color: colorSchema.optional() });
export type TagUpdate = z.input<typeof tagUpdate>;
export const tagMergeInput = z.object({ intoId: id });

export const reorderInput = z.object({ ids: z.array(id).min(1) });
export type ReorderInput = z.input<typeof reorderInput>;
export const inviteInput = z.object({ email: z.email().toLowerCase(), role: roleSchema.default("member") });
export const goalInput = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), targetCents: cents });

export const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
export const workspaceUpdate = z.object({
  name: z.string().trim().min(1, "Workspace name is required").max(80).optional(),
  timezone: z.string().refine(isValidTimeZone, "Choose a valid time zone").optional(),
});
export type WorkspaceUpdate = z.input<typeof workspaceUpdate>;

export interface WorkspaceDTO { name: string; timezone: string; currency: string }
export interface SourceAdminDTO { id: string; name: string; color: Color; position: number; archived: boolean; leadCount: number }
export interface StageAdminDTO { id: string; name: string; color: Color; kind: StageKind; position: number; leadCount: number }
export interface TagAdminDTO { id: string; name: string; color: Color; leadCount: number }
export interface ResetLinkDTO { resetUrl: string; expiresAt: string }

// ---------- Pipeline board ----------
export const pipelineQuery = z.object({
  ownerId: z.preprocess((v) => (v === undefined || v === "" ? undefined : (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(",")).filter(Boolean)), z.array(id).optional()),
  sourceId: z.preprocess((v) => (v === undefined || v === "" ? undefined : (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(",")).filter(Boolean)), z.array(id).optional()),
  /** Won/Lost columns only show deals closed in this many days, so they don't grow forever. */
  closedWithinDays: z.coerce.number().int().min(1).max(3650).default(90),
  /** Cards returned per column; counts and totals always cover the whole column. */
  perColumn: z.coerce.number().int().min(1).max(200).default(50),
});
export type PipelineQuery = z.input<typeof pipelineQuery>;

// ---------- Dashboard, feed, goals ----------
export const DASHBOARD_RANGES = ["7d", "30d", "90d", "365d"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export const dashboardQuery = z.object({
  range: z.enum(DASHBOARD_RANGES).default("30d"),
  /** "me" limits every number to leads the viewer owns. */
  scope: z.enum(["team", "me"]).default("team"),
});
export type DashboardQuery = z.input<typeof dashboardQuery>;

export interface KpiDTO { value: number; previous: number | null }
export interface DashboardDTO {
  range: DashboardRange;
  scope: "team" | "me";
  kpis: {
    /** Leads created in the period (vs the previous period). */
    newLeads: KpiDTO;
    /** Open hot leads right now. */
    hotLeads: KpiDTO;
    /** Deals moved to Won in the period (count), and their value. */
    dealsWon: KpiDTO;
    wonValueCents: KpiDTO;
    /** Total value of open deals right now. */
    pipelineValueCents: KpiDTO;
    openDeals: number;
    /** Deals moved to Lost in the period. */
    dealsLost: KpiDTO;
    /** won / (won + lost) for deals closed in the period, 0–1; null when none closed. */
    winRate: { value: number | null; previous: number | null };
  };
  /** Leads created in the period, by source. */
  bySource: { source: SourceRef | null; count: number }[];
  /** Current leads per active stage. */
  byStage: { stage: StageRef; count: number; valueCents: number }[];
}

export const feedQuery = z.object({
  /** Cursor: ISO time of the last event already shown. */
  before: isoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  actorId: id.optional(),
  leadId: id.optional(),
  type: z.preprocess((v) => (v === undefined || v === "" ? undefined : (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(","))), z.array(eventTypeSchema).optional()),
});
export type FeedQuery = z.input<typeof feedQuery>;

export interface FeedEventDTO {
  id: string;
  type: EventType;
  createdAt: string;
  actor: UserRef | null;
  lead: { id: string; fullName: string; deleted: boolean } | null;
  /** The other person involved, e.g. who a lead or task was assigned to. */
  subjectUser: UserRef | null;
  payload: Record<string, unknown>;
}
export interface FeedPageDTO { events: FeedEventDTO[]; nextBefore: string | null }

export interface GoalDTO {
  month: string;
  targetCents: number | null;
  /** Value of deals won this month (workspace time zone). */
  wonCents: number;
}
export const goalUpdate = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM"), targetCents: cents.nullable() });
export type GoalUpdate = z.input<typeof goalUpdate>;

// ---------- Search ----------
export const searchQuery = z.object({ q: z.string().trim().min(2, "Type at least 2 characters").max(100) });
export interface SearchResultsDTO {
  leads: { id: string; fullName: string; company: string | null; email: string | null; stage: StageRef }[];
  tasks: { id: string; title: string; dueAt: string | null; completedAt: string | null; lead: { id: string; fullName: string } | null }[];
  documents: { id: string; filename: string; lead: { id: string; fullName: string } }[];
}

// ---------- Notifications ----------
/** Notification settings are per category; each category covers some event types. */
export const NOTIFICATION_CATEGORIES = [
  { key: "assignments", label: "Assigned to me", description: "A lead or task is assigned to you", types: ["lead.assigned", "task.created"] },
  { key: "reminders", label: "Reminders", description: "Follow-ups and tasks due today", types: ["followup.due", "task.due"] },
  { key: "my_leads", label: "Updates on my leads", description: "Stage changes, logged activity, pinned notes and uploads on leads you own", types: ["lead.stage_changed", "lead.won", "lead.lost", "activity.logged", "note.pinned", "document.uploaded"] },
  { key: "documents", label: "Document views", description: "Someone opens a document you shared", types: ["document.viewed"] },
  { key: "system", label: "System alerts", description: "Admins only: a new error happened in the app (details on Settings → System status)", types: ["system.error"], adminOnly: true },
] as const satisfies readonly { key: string; label: string; description: string; types: readonly EventType[]; adminOnly?: boolean }[];
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]["key"];
export const notificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES.map((c) => c.key) as [NotificationCategory, ...NotificationCategory[]]);

export interface NotificationDTO { id: string; readAt: string | null; createdAt: string; event: FeedEventDTO }
export interface NotificationPageDTO { items: NotificationDTO[]; unreadCount: number; nextBefore: string | null }
export const notificationListQuery = z.object({
  before: isoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  unread: z.enum(["1", "0"]).optional(),
});
export const notificationReadInput = z.object({ ids: z.array(id).max(200).optional() });
export interface NotificationPrefsDTO { categories: { key: NotificationCategory; inApp: boolean }[] }
export const notificationPrefUpdate = z.object({ key: notificationCategorySchema, inApp: z.boolean() });

// ---------- Reports ----------
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
/** Date range (inclusive, workspace time zone) and optional filters. Defaults to the last 90 days. */
export const reportQuery = z
  .object({
    from: isoDay.optional(),
    to: isoDay.optional(),
    ownerId: z.uuid().optional(),
    sourceId: z.uuid().optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "The start date must be on or before the end date", path: ["from"] });
export type ReportQuery = z.input<typeof reportQuery>;

export interface ReportsDTO {
  range: { from: string; to: string; timezone: string };
  /** Deals closed (won or lost) in the range, plus leads created in it. */
  summary: {
    created: number;
    won: number;
    wonCents: number;
    lost: number;
    lostCents: number;
    /** won / (won + lost); null when nothing closed. */
    winRate: number | null;
    avgDealCents: number | null;
    /** Days from creation to won, for deals won in the range. */
    avgCycleDays: number | null;
    medianCycleDays: number | null;
  };
  lostReasons: { reason: LostReason; count: number; valueCents: number }[];
  /** Leads created in the range, by source, and what became of them. */
  sources: { source: SourceRef | null; created: number; won: number; lost: number; open: number; wonCents: number; conversion: number | null; avgCycleDays: number | null }[];
  /** Deals closed in the range, by owner. */
  owners: { owner: UserRef | null; won: number; lost: number; wonCents: number; winRate: number | null; avgCycleDays: number | null }[];
  /** Deals won in the range, by days to close. */
  cycleBuckets: { label: string; count: number }[];
  /** Closed deals per month in the range. */
  monthly: { month: string; won: number; lost: number; wonCents: number }[];
}

// ---------- Calendar ----------
export const CALENDAR_KINDS = ["meeting", "call", "email", "note", "task", "followup", "close"] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];
/** A window of at most 62 days (a month view plus the days shown from the months around it). */
export const calendarQuery = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    userId: z.uuid().optional(),
    /** Comma-separated CalendarKind values; all when omitted. */
    kinds: z.string().max(200).optional(),
  })
  .refine((q) => new Date(q.from) < new Date(q.to), { message: "The end must be after the start", path: ["to"] })
  .refine((q) => new Date(q.to).getTime() - new Date(q.from).getTime() <= 62 * 86_400_000, { message: "Choose a range of at most 62 days", path: ["to"] });
export type CalendarQuery = z.input<typeof calendarQuery>;

export interface CalendarItemDTO {
  /** "<kind>:<record id>", unique across kinds. */
  id: string;
  kind: CalendarKind;
  title: string;
  /** ISO time; for all-day items (expected close) a YYYY-MM-DD date. */
  at: string;
  allDay: boolean;
  /** Tasks only: completed. */
  done: boolean;
  lead: { id: string; fullName: string } | null;
  /** Who it belongs to: the activity's author, task's assignee, or lead's owner. */
  person: UserRef | null;
}

// ---------- System status (admins) ----------
export const clientErrorInput = z.object({
  message: z.string().trim().min(1).max(500),
  stack: z.string().max(4000).optional(),
  path: z.string().max(300).optional(),
  source: z.string().max(20).optional(),
});
export const errorListQuery = z.object({ status: z.enum(["open", "resolved"]).default("open"), limit: z.coerce.number().int().min(1).max(200).default(50) });

export interface AppErrorDTO {
  id: string;
  source: "server" | "client";
  message: string;
  stack: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  user: UserRef | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

export interface SystemStatusDTO {
  /** "ok" when every check passes, "degraded" when something needs attention. */
  overall: "ok" | "degraded";
  database: { ok: boolean; latencyMs: number | null };
  jobs: { lastRunAt: string | null; ok: boolean };
  errors: { open: number; last24h: number };
  storage: "blob" | "disk";
  email: { configured: boolean };
  deployment: { environment: string; region: string | null; commit: string | null; startedAt: string };
  checkedAt: string;
}
