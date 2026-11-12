import { z } from "zod";

export const ROLES = ["admin", "member"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const TEMPERATURES = ["hot", "warm", "cold"] as const;
export const temperatureSchema = z.enum(TEMPERATURES);
export type Temperature = z.infer<typeof temperatureSchema>;

export const STAGE_KINDS = ["open", "won", "lost"] as const;
export const stageKindSchema = z.enum(STAGE_KINDS);
export type StageKind = z.infer<typeof stageKindSchema>;

export const PROJECT_TYPES = ["one_time", "retainer", "hourly"] as const;
export const projectTypeSchema = z.enum(PROJECT_TYPES);
export type ProjectType = z.infer<typeof projectTypeSchema>;

export const LEAD_INTENTS = ["active", "passive", "nurture"] as const;
export const leadIntentSchema = z.enum(LEAD_INTENTS);
export type LeadIntent = z.infer<typeof leadIntentSchema>;

export const DEAL_SIZES = ["small", "mid", "enterprise"] as const;
export const dealSizeSchema = z.enum(DEAL_SIZES);
export type DealSize = z.infer<typeof dealSizeSchema>;

export const ACTIVITY_TYPES = ["call", "email", "meeting", "note"] as const;
export const activityTypeSchema = z.enum(ACTIVITY_TYPES);
export type ActivityType = z.infer<typeof activityTypeSchema>;

export const LOST_REASONS = ["budget", "no_response", "competitor", "not_a_fit", "timing", "other"] as const;
export const lostReasonSchema = z.enum(LOST_REASONS);
export type LostReason = z.infer<typeof lostReasonSchema>;

export const USER_STATUSES = ["active", "away"] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const DOCUMENT_STATUSES = ["uploaded", "sent", "viewed"] as const;
export const documentStatusSchema = z.enum(DOCUMENT_STATUSES);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

/** Event types drive the activity feed, notifications, and notification preferences. */
export const EVENT_TYPES = [
  "lead.created",
  "lead.assigned",
  "lead.stage_changed",
  "lead.won",
  "lead.lost",
  "activity.logged",
  "note.pinned",
  "task.created",
  "task.completed",
  "document.uploaded",
  "document.viewed",
  "followup.due",
  "task.due",
  /** A new server or browser error; goes to admins only and never appears in the team feed. */
  "system.error",
] as const;
export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;

/** Color tokens that match the CSS classes in the web app (badge-*, bg-*). */
export const COLORS = ["violet", "green", "amber", "red", "blue", "orange", "gray"] as const;
export const colorSchema = z.enum(COLORS);
export type Color = z.infer<typeof colorSchema>;
