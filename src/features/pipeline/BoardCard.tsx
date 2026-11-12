import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRef } from "react";
import { Link, useNavigate } from "react-router";
import type { LeadListItemDTO } from "@crm/shared";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Icon from "@/components/ui/Icon";
import { TEMPERATURE_LABELS, temperatureTone } from "@/features/leads/labels";
import { formatFollowup, formatMoney, initials } from "@/lib/format";

/** Visual card, shared by the sortable card and the drag overlay. */
export function CardBody({ lead, linkName = true }: { lead: LeadListItemDTO; linkName?: boolean }) {
  const followup = formatFollowup(lead.nextFollowupAt);
  return (
    <>
      <div className="kanban-title"><div>
        {linkName ? <Link to={`/leads/${lead.id}`} className="row-link" onClick={(e) => e.stopPropagation()}><b>{lead.fullName}</b></Link> : <b>{lead.fullName}</b>}
        <small>{lead.company ?? "—"}</small>
      </div>{!lead.canEdit && <span className="lock" title="Only the owner or an admin can move this lead" aria-hidden="true">🔒</span>}</div>
      <div className="kanban-badges">{lead.source && <Badge tone={lead.source.color}>{lead.source.name}</Badge>}<Badge tone={temperatureTone(lead.temperature)} dot>{TEMPERATURE_LABELS[lead.temperature]}</Badge></div>
      <div className="kanban-value">{formatMoney(lead.valueCents)}</div>
      {lead.pinnedNote && <div className="kanban-note">“{lead.pinnedNote.length > 90 ? `${lead.pinnedNote.slice(0, 90)}…` : lead.pinnedNote}”</div>}
      <div className="kanban-foot">
        {lead.owner ? <Avatar initials={initials(lead.owner.name)} size="sm" color={lead.owner.avatarColor} /> : <span className="muted">Unassigned</span>}
        {lead.nextFollowupAt && <span className={followup.overdue ? "danger-text" : ""}><Icon name="calendar" size={13} />{followup.label}</span>}
      </div>
    </>
  );
}

export default function BoardCard({ lead }: { lead: LeadListItemDTO }) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lead.id, disabled: !lead.canEdit });
  // A drag that ends over the card would otherwise also count as a click.
  const dragged = useRef(false);
  if (isDragging) dragged.current = true;

  return (
    <div
      ref={setNodeRef}
      className={`kanban-card border-${lead.temperature} ${isDragging ? "is-dragging" : ""} ${lead.canEdit ? "can-drag" : ""}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-roledescription={lead.canEdit ? "draggable lead" : "lead"}
      aria-label={`${lead.fullName}${lead.company ? `, ${lead.company}` : ""}, ${formatMoney(lead.valueCents)}`}
      onClick={() => {
        if (dragged.current) { dragged.current = false; return; }
        navigate(`/leads/${lead.id}`);
      }}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === "Enter" && !e.defaultPrevented && !lead.canEdit) navigate(`/leads/${lead.id}`);
      }}
    >
      <CardBody lead={lead} />
    </div>
  );
}
