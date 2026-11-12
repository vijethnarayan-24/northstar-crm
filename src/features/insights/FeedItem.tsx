import type { ReactNode } from "react";
import { Link } from "react-router";
import type { EventType, FeedEventDTO } from "@crm/shared";
import Icon from "@/components/ui/Icon";
import { ACTIVITY_LABELS, LOST_REASON_LABELS } from "@/features/leads/labels";
import { relativeTime } from "@/lib/format";
import type { Tone } from "@/types";

const META: Record<EventType, { icon: string; tone: Tone }> = {
  "lead.created": { icon: "users", tone: "violet" },
  "lead.assigned": { icon: "users", tone: "blue" },
  "lead.stage_changed": { icon: "pipeline", tone: "violet" },
  "lead.won": { icon: "trend", tone: "green" },
  "lead.lost": { icon: "x", tone: "red" },
  "activity.logged": { icon: "mail", tone: "blue" },
  "note.pinned": { icon: "edit", tone: "amber" },
  "task.created": { icon: "check", tone: "gray" },
  "task.completed": { icon: "check", tone: "green" },
  "document.uploaded": { icon: "file", tone: "gray" },
  "document.viewed": { icon: "file", tone: "amber" },
  "followup.due": { icon: "clock", tone: "orange" },
  "task.due": { icon: "clock", tone: "amber" },
  "system.error": { icon: "flame", tone: "red" },
};

/** Grouping used by the feed's type filter. */
export const FEED_TYPE_GROUPS: { label: string; types: EventType[] }[] = [
  { label: "New leads", types: ["lead.created", "lead.assigned"] },
  { label: "Stage changes", types: ["lead.stage_changed", "lead.won", "lead.lost"] },
  { label: "Activities & notes", types: ["activity.logged", "note.pinned"] },
  { label: "Tasks", types: ["task.created", "task.completed", "task.due"] },
  { label: "Reminders", types: ["followup.due", "task.due"] },
  { label: "Documents", types: ["document.uploaded", "document.viewed"] },
];

const s = (v: unknown) => (typeof v === "string" ? v : "");

/** One readable sentence per event, with the lead linked (unless it was deleted). */
export function describeEvent(e: FeedEventDTO): ReactNode {
  const who = e.actor?.name.split(" ")[0] ?? "Someone";
  const lead = e.lead ? (e.lead.deleted ? <span className="muted">{e.lead.fullName} (deleted)</span> : <Link to={`/leads/${e.lead.id}`}>{e.lead.fullName}</Link>) : null;
  const p = e.payload;
  switch (e.type) {
    case "lead.created": return <>{who} added a new lead {lead}</>;
    case "lead.assigned": return <>{who} assigned {lead} to {e.subjectUser?.name.split(" ")[0] ?? "someone"}</>;
    case "lead.stage_changed": return <>{who} moved {lead} {s(p.from) ? <>from {s(p.from)} </> : null}to {s(p.to)}{p.reason === "stage_removed" ? " (stage removed)" : ""}</>;
    case "lead.won": return <>{who} won {lead}</>;
    case "lead.lost": return <>{who} marked {lead} as lost{s(p.reason) ? ` · ${LOST_REASON_LABELS[p.reason as keyof typeof LOST_REASON_LABELS] ?? s(p.reason)}` : ""}</>;
    case "activity.logged": {
      const label = ACTIVITY_LABELS[p.activityType as keyof typeof ACTIVITY_LABELS]?.label.toLowerCase() ?? "activity";
      return <>{who} logged {/^[aeiou]/.test(label) ? "an" : "a"} {label} with {lead}{s(p.title) ? <>: “{s(p.title)}”</> : null}</>;
    }
    case "note.pinned": return <>{who} pinned a note on {lead}</>;
    case "task.created": return <>{who} added a task{lead ? <> on {lead}</> : null}{s(p.title) ? <>: “{s(p.title)}”</> : null}</>;
    case "task.completed": return <>{who} completed “{s(p.title)}”{lead ? <> on {lead}</> : null}</>;
    case "document.uploaded": return <>{who} uploaded {s(p.filename)} to {lead}</>;
    case "document.viewed": return <>{s(p.filename) || "A document"} was viewed{s(p.viewer) ? ` by ${s(p.viewer)}` : ""}{lead ? <> ({lead})</> : null}</>;
    case "followup.due": return <>Follow-up due today for {lead}</>;
    case "task.due": return <>Task due today: “{s(p.title)}”{lead ? <> on {lead}</> : null}</>;
    case "system.error": return <>{p.source === "client" ? "Browser" : "Server"} error{Number(p.count) > 1 ? ` (seen ${Number(p.count)} times)` : ""}: “{s(p.message)}”</>;
  }
}

export default function FeedItem({ event, compact = false }: { event: FeedEventDTO; compact?: boolean }) {
  const meta = META[event.type];
  return (
    <div className={compact ? "activity-item" : "feed-row"}>
      <span className={`activity-icon bg-soft-${meta.tone}`}><Icon name={meta.icon} size={15} /></span>
      <div><b>{describeEvent(event)}</b><small title={new Date(event.createdAt).toLocaleString()}>{relativeTime(event.createdAt)}</small></div>
    </div>
  );
}
