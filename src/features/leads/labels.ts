import type { ActivityType, DealSize, LeadIntent, LostReason, ProjectType, Temperature } from "@crm/shared";
import type { Tone } from "@/types";

export const TEMPERATURE_LABELS: Record<Temperature, string> = { hot: "Hot", warm: "Warm", cold: "Cold" };
export const temperatureTone = (t: Temperature): Tone => (t === "hot" ? "red" : t === "warm" ? "orange" : "blue");

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = { one_time: "One-time", retainer: "Retainer", hourly: "Hourly" };
export const INTENT_LABELS: Record<LeadIntent, string> = { active: "Active", passive: "Passive", nurture: "Nurture" };
export const DEAL_SIZE_LABELS: Record<DealSize, string> = { small: "Small", mid: "Mid", enterprise: "Enterprise" };
export const LOST_REASON_LABELS: Record<LostReason, string> = {
  budget: "Budget",
  no_response: "No response",
  competitor: "Went with a competitor",
  not_a_fit: "Not a fit",
  timing: "Timing",
  other: "Other",
};
export const ACTIVITY_LABELS: Record<ActivityType, { label: string; icon: string; tone: Tone }> = {
  email: { label: "Email", icon: "mail", tone: "blue" },
  call: { label: "Call", icon: "phone", tone: "green" },
  meeting: { label: "Meeting", icon: "calendar", tone: "violet" },
  note: { label: "Note", icon: "edit", tone: "amber" },
};

/** Lead age badge colour: fresh → gray, a week → amber, two weeks → red. */
export const ageTone = (days: number): Tone => (days >= 14 ? "red" : days >= 7 ? "amber" : "gray");
