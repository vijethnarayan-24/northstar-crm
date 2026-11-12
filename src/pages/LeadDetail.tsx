import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { ActivityDTO, DealSize, LeadDetailDTO, LeadIntent, ProjectType, StageRef, TaskDTO, Temperature } from "@crm/shared";
import FormAlert from "@/components/form/FormAlert";
import { useAppActions } from "@/components/layout/navigation";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import Icon from "@/components/ui/Icon";
import Menu from "@/components/ui/Menu";
import { ACTIVITY_LABELS, ageTone, DEAL_SIZE_LABELS, INTENT_LABELS, LOST_REASON_LABELS, PROJECT_TYPE_LABELS, TEMPERATURE_LABELS, temperatureTone } from "@/features/leads/labels";
import ActivityComposer, { EditActivityDialog } from "@/features/leads/ActivityComposer";
import LostDialog from "@/features/leads/LostDialog";
import DocumentsTab from "@/features/documents/DocumentsTab";
import { ConfirmDialog } from "@/features/settings/SettingsParts";
import TaskDialog from "@/features/tasks/TaskDialog";
import TaskRow from "@/features/tasks/TaskRow";
import { useDeleteActivity, useDeleteTask } from "@/features/tasks/useTasks";
import { useDeleteLead, useLead, useLeadActivities, useLeadTasks, useLookups, useLeadHistory, useMoveLead, useUpdateLead } from "@/features/leads/useLeads";
import { ApiError, errorMessage } from "@/lib/api";
import { daysSince, formatDate, formatDateTime, formatFollowup, formatMoney, initials, relativeTime } from "@/lib/format";
import { SkeletonList } from "@/components/ui/Skeleton";

const TABS = ["Activity", "Tasks", "Documents", "History"] as const;
type Tab = (typeof TABS)[number];

export default function LeadDetail() {
  const { id = "" } = useParams();
  const lead = useLead(id);

  if (lead.isPending) return <div className="page"><p className="empty-note">Loading lead…</p></div>;
  if (lead.isError) {
    const missing = lead.error instanceof ApiError && lead.error.status === 404;
    return (
      <div className="page">
        <Link className="back-button" to="/leads">← Back to leads</Link>
        <div className="empty-state card">
          <b>{missing ? "Lead not found" : "Couldn't load this lead"}</b>
          <p>{missing ? "It may have been deleted, or the link is wrong." : errorMessage(lead.error)}</p>
          {!missing && <Button variant="secondary" onClick={() => lead.refetch()}>Try again</Button>}
        </div>
      </div>
    );
  }
  return <LeadDetailView lead={lead.data} />;
}

function LeadDetailView({ lead }: { lead: LeadDetailDTO }) {
  const navigate = useNavigate();
  const { openEditLead } = useAppActions();
  const lookups = useLookups();
  const move = useMoveLead(lead.id);
  const remove = useDeleteLead();
  // ?tab=documents (used by search results) opens a specific tab.
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => TABS.find((t) => t.toLowerCase().replace(" ", "-") === params.get("tab")) ?? "Activity");
  const [lostOpen, setLostOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const logActivity = () => { setTab("Activity"); setComposerOpen(true); };

  const stages = lookups.data?.stages ?? [lead.stage];
  const currentIndex = stages.findIndex((s) => s.id === lead.stage.id);
  const followup = formatFollowup(lead.nextFollowupAt);
  const age = daysSince(lead.createdAt);
  const subtitle = [lead.jobTitle, lead.company].filter(Boolean).join(" at ");

  const selectStage = (s: StageRef) => {
    if (!lead.canEdit || s.id === lead.stage.id || move.isPending) return;
    if (s.kind === "lost") setLostOpen(true);
    else move.mutate({ stageId: s.id });
  };

  return <div className="page">
    <Link className="back-button" to="/leads">← Back to leads</Link>
    <div className="detail-heading">
      <div className="person-title"><Avatar initials={initials(lead.fullName)} size="lg" color={lead.owner?.avatarColor ?? "gray"}/><div><h1>{lead.fullName}</h1>{subtitle && <p>{subtitle}</p>}</div></div>
      <div className="detail-actions">
        {lead.canEdit && <Button variant="secondary" icon="edit" onClick={() => openEditLead(lead.id)}>Edit lead</Button>}
        <Button icon="plus" onClick={logActivity}>Log activity</Button>
        {lead.canDelete && <Menu label="More actions" trigger={<Icon name="more"/>} items={[{ label: "Delete lead…", danger: true, onSelect: () => setConfirmDelete(true) }]}/>}
      </div>
    </div>

    {move.isError && !lostOpen && <FormAlert>{errorMessage(move.error)}</FormAlert>}
    {!lead.canEdit && <p className="muted-note readonly-note">You can view this lead. Only {lead.owner?.name ?? "its owner"} or an admin can change it.</p>}

    <div className="stage-strip"><span id="stage-label">Current stage</span><div role="group" aria-labelledby="stage-label">{stages.map((s, i) => {
      const complete = lead.stage.kind !== "lost" && currentIndex > i && s.kind === "open";
      return <button key={s.id} type="button" aria-current={s.id === lead.stage.id ? "step" : undefined} disabled={!lead.canEdit || move.isPending}
        className={`${s.id === lead.stage.id ? "active" : ""} ${complete ? "complete" : ""} ${s.kind === "lost" ? "stage-lost" : ""}`} onClick={() => selectStage(s)}>
        <i>{complete ? "✓" : i + 1}</i>{s.name}</button>;
    })}</div></div>

    {lead.stage.kind === "lost" && lead.lostReason && (
      <div className="lost-banner"><b>Lost · {LOST_REASON_LABELS[lead.lostReason]}</b>{lead.lostNotes && <span>{lead.lostNotes}</span>}<small>{formatDate(lead.lostAt)}</small></div>
    )}
    {lead.stage.kind === "won" && <div className="won-banner"><b>Won {formatDate(lead.wonAt)}</b><span>{formatMoney(lead.valueCents)}</span></div>}

    <div className="detail-layout"><aside className="detail-info">
      <PinnedNote lead={lead}/>
      <section className="card info-card"><div className="card-header"><h2>Lead information</h2>{lead.canEdit && <button className="icon-btn" aria-label="Edit lead information" onClick={() => openEditLead(lead.id)}><Icon name="edit" size={16}/></button>}</div>
        <div className="info-list">
          <div><span><Icon name="mail" size={15}/> Email</span>{lead.email ? <a href={`mailto:${lead.email}`}><b>{lead.email}</b></a> : <b className="muted">—</b>}</div>
          <div><span><Icon name="phone" size={15}/> Phone</span>{lead.phone ? <a href={`tel:${lead.phone.replace(/\s/g, "")}`}><b>{lead.phone}</b></a> : <b className="muted">—</b>}</div>
          <div><span>Location</span><b>{lead.location ?? "—"}</b></div>
          <div><span>Source</span>{lead.source ? <Badge tone={lead.source.color}>{lead.source.name}</Badge> : <b className="muted">—</b>}</div>
          <div><span>Lead type</span><b>{lead.leadType ?? "—"}</b></div>
          <div><span>Temperature</span><Badge tone={temperatureTone(lead.temperature)} dot>{TEMPERATURE_LABELS[lead.temperature]}</Badge></div>
          <div><span>Intent</span><b>{lead.intent ? INTENT_LABELS[lead.intent] : "—"}</b></div>
        </div>
        <hr/><div className="deal-big"><span>Estimated deal value</span><b>{formatMoney(lead.valueCents)}</b><small>{[lead.projectType && PROJECT_TYPE_LABELS[lead.projectType], lead.dealSize && DEAL_SIZE_LABELS[lead.dealSize]].filter(Boolean).join(" · ") || "Project type not set"}</small></div><hr/>
        <div className="info-list">
          <div><span>Owner</span>{lead.owner ? <span className="owner"><Avatar initials={initials(lead.owner.name)} size="sm" color={lead.owner.avatarColor}/>{lead.owner.name}</span> : <b className="muted">Unassigned</b>}</div>
          <div><span>Next follow-up</span><b className={followup.overdue ? "danger-text" : ""}>{followup.label}</b></div>
          <div><span>Lead age</span><Badge tone={ageTone(age)}>{age} {age === 1 ? "day" : "days"}</Badge></div>
          <div><span>Expected close</span><b>{formatDate(lead.expectedClose)}</b></div>
          <div><span>Created</span><b>{formatDate(lead.createdAt)}{lead.createdBy ? ` by ${lead.createdBy.name.split(" ")[0]}` : ""}</b></div>
        </div>
        <div className="tag-row">{lead.tags.map((t) => <Badge key={t.id} tone={t.color}>{t.name}</Badge>)}{lead.canEdit && <button type="button" onClick={() => openEditLead(lead.id)}>{lead.tags.length ? "Edit tags" : "+ Add tags"}</button>}</div>
      </section>
    </aside>
    <section className="card detail-main">
      <div className="detail-tabs" role="tablist">{TABS.map(t => <button role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)} key={t}>{t}{t === "Tasks" && lead.counts.openTasks > 0 && <span>{lead.counts.openTasks}</span>}{t === "Documents" && lead.counts.documents > 0 && <span>{lead.counts.documents}</span>}</button>)}</div>
      <div role="tabpanel">
        {tab === "Activity" && <ActivityTab id={lead.id} composerOpen={composerOpen} setComposerOpen={setComposerOpen}/>}
        {tab === "Tasks" && <TasksTab lead={lead}/>}
        {tab === "Documents" && <DocumentsTab leadId={lead.id}/>}
        {tab === "History" && <HistoryTab id={lead.id}/>}
      </div>
    </section></div>

    {lostOpen && <LostDialog leadName={lead.fullName} pending={move.isPending} error={move.error}
      onClose={() => { setLostOpen(false); move.reset(); }}
      onConfirm={(reason, notes) => {
        const lost = stages.find((s) => s.kind === "lost");
        if (lost) move.mutate({ stageId: lost.id, lostReason: reason, lostNotes: notes }, { onSuccess: () => setLostOpen(false) });
      }}/>}
    {confirmDelete && (
      <Dialog title={`Delete ${lead.fullName}?`} description="The lead disappears from lists, the pipeline and reports." onClose={() => setConfirmDelete(false)}
        footer={<><Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(lead.id, { onSuccess: () => navigate("/leads", { replace: true }) })}>Delete lead</Button></>}>
        {remove.isError ? <FormAlert>{errorMessage(remove.error)}</FormAlert> : <span/>}
      </Dialog>
    )}
  </div>;
}

function PinnedNote({ lead }: { lead: LeadDetailDTO }) {
  const update = useUpdateLead(lead.id);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(lead.pinnedNote ?? "");
  const save = (value: string) => update.mutate({ pinnedNote: value }, { onSuccess: () => setEditing(false) });

  if (editing) return (
    <div className="sticky-note editing">
      <label htmlFor="pinned-edit">Pinned note</label>
      <textarea id="pinned-edit" autoFocus value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
      {update.isError && <small className="field-error">{errorMessage(update.error)}</small>}
      <div className="note-actions">
        <Button variant="secondary" onClick={() => { setEditing(false); setText(lead.pinnedNote ?? ""); }}>Cancel</Button>
        <Button disabled={update.isPending} onClick={() => save(text)}>{update.isPending ? "Saving…" : "Save note"}</Button>
      </div>
    </div>
  );
  if (!lead.pinnedNote) return lead.canEdit ? <button type="button" className="sticky-note empty" onClick={() => { setText(""); setEditing(true); }}>+ Pin a note for your team</button> : null;
  return (
    <div className="sticky-note">
      <span>Pinned note</span><p>{lead.pinnedNote}</p>
      <small>{lead.pinnedBy ? `Added by ${lead.pinnedBy.name.split(" ")[0]} · ` : ""}{relativeTime(lead.pinnedAt)}</small>
      {lead.canEdit && <div className="note-actions inline">
        <button type="button" className="text-button" onClick={() => { setText(lead.pinnedNote ?? ""); setEditing(true); }}>Edit</button>
        <button type="button" className="text-button" disabled={update.isPending} onClick={() => save("")}>Unpin</button>
      </div>}
    </div>
  );
}

function TabState({ query, empty, children }: { query: { isPending: boolean; isError: boolean; error: unknown; data?: unknown[] }; empty: string; children: React.ReactNode }) {
  if (query.isPending) return <SkeletonList rows={3}/>;
  if (query.isError) return <div className="tab-note"><FormAlert>{errorMessage(query.error)}</FormAlert></div>;
  if (!query.data?.length) return <p className="empty-note tab-note">{empty}</p>;
  return <>{children}</>;
}

function ActivityTab({ id, composerOpen, setComposerOpen }: { id: string; composerOpen: boolean; setComposerOpen: (open: boolean) => void }) {
  const q = useLeadActivities(id);
  const remove = useDeleteActivity(id);
  const [editing, setEditing] = useState<ActivityDTO | null>(null);
  const [deleting, setDeleting] = useState<ActivityDTO | null>(null);
  return <div className="timeline">
    <ActivityComposer leadId={id} open={composerOpen} setOpen={setComposerOpen}/>
    <TabState query={q} empty="No activity logged yet. Log your first call, email, meeting or note above.">{q.data?.map((a, i) => {
      const meta = ACTIVITY_LABELS[a.type];
      return <div className="timeline-entry" key={a.id}><div className={`timeline-icon bg-soft-${meta.tone}`}><Icon name={meta.icon} size={16}/></div><div className="timeline-card">
        <div className="timeline-meta"><Badge tone={meta.tone}>{meta.label}</Badge><span>{formatDateTime(a.occurredAt)}</span>{a.author && <Avatar initials={initials(a.author.name)} size="sm" color={a.author.avatarColor}/>}
          {a.canEdit && <Menu label={`Actions for ${a.title}`} trigger={<Icon name="more"/>} items={[
            { label: "Edit", onSelect: () => setEditing(a) },
            { label: "Delete…", danger: true, onSelect: () => setDeleting(a) },
          ]}/>}
        </div>
        <h3>{a.title}</h3>{a.body && <p className="preserve-lines">{a.body}</p>}
        {a.nextStep && <div className="next-step"><b>Next step</b><span>{a.nextStep}</span></div>}
      </div>{i < q.data!.length - 1 && <span className="timeline-line"/>}</div>;
    })}</TabState>
    {editing && <EditActivityDialog leadId={id} activity={editing} onClose={() => setEditing(null)}/>}
    {deleting && <ConfirmDialog title="Delete this activity?" description={`“${deleting.title}” will be removed from the timeline. Tasks created from it are kept.`} confirmLabel="Delete activity"
      pending={remove.isPending} error={remove.error} onClose={() => { setDeleting(null); remove.reset(); }} onConfirm={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}/>}
  </div>;
}

function TasksTab({ lead }: { lead: LeadDetailDTO }) {
  const q = useLeadTasks(lead.id);
  const remove = useDeleteTask();
  const [dialog, setDialog] = useState<{ task?: TaskDTO } | null>(null);
  const [deleting, setDeleting] = useState<TaskDTO | null>(null);
  return <div>
    <div className="tab-toolbar"><Button icon="plus" variant="secondary" onClick={() => setDialog({})}>Add task</Button></div>
    <TabState query={q} empty="No tasks for this lead yet."><div className="tasks-panel">{q.data?.map((t) =>
      <TaskRow key={t.id} task={t} showLead={false} onEdit={(task) => setDialog({ task })} onDelete={setDeleting}/>)}</div></TabState>
    {dialog && <TaskDialog task={dialog.task} lead={{ id: lead.id, fullName: lead.fullName, company: lead.company, ownerId: lead.owner?.id ?? null }} defaultAssigneeId={lead.owner?.id} onClose={() => setDialog(null)}/>}
    {deleting && <ConfirmDialog title="Delete this task?" description={`“${deleting.title}” will be removed.`} confirmLabel="Delete task" pending={remove.isPending} error={remove.error}
      onClose={() => { setDeleting(null); remove.reset(); }} onConfirm={() => remove.mutate(deleting, { onSuccess: () => setDeleting(null) })}/>}
  </div>;
}


/** Readable names for the lead fields recorded in its change history. */
const FIELD_LABELS: Record<string, string> = {
  fullName: "Name", company: "Company", jobTitle: "Job title", email: "Email", phone: "Phone", location: "Location",
  source: "Source", leadType: "Lead type", projectType: "Project type", temperature: "Temperature", intent: "Intent",
  valueCents: "Deal value", dealSize: "Deal size", expectedClose: "Expected close", owner: "Owner",
  nextFollowupAt: "Next follow-up", pinnedNote: "Pinned note", tags: "Tags",
};

function formatChangeValue(field: string, value: string | null) {
  if (value === null) return "empty";
  switch (field) {
    case "valueCents": return formatMoney(Number(value));
    case "nextFollowupAt": return formatDateTime(value);
    case "expectedClose": return formatDate(value);
    case "temperature": return TEMPERATURE_LABELS[value as Temperature] ?? value;
    case "projectType": return PROJECT_TYPE_LABELS[value as ProjectType] ?? value;
    case "intent": return INTENT_LABELS[value as LeadIntent] ?? value;
    case "dealSize": return DEAL_SIZE_LABELS[value as DealSize] ?? value;
    case "pinnedNote": return value.length > 80 ? `“${value.slice(0, 80)}…”` : `“${value}”`;
    default: return value;
  }
}

/** Every stage move and field edit on the lead, newest first, with who made it. */
function HistoryTab({ id }: { id: string }) {
  const q = useLeadHistory(id);
  const who = (by: { name: string } | null) => (by ? ` · ${by.name}` : "");
  return <TabState query={q} empty="No changes yet."><div className="history-list change-history">{q.data?.map((h) => (
    <div key={h.id} className={`history-${h.kind}`}><span/><div>
      {h.kind === "stage" && <b>{h.from ? `Moved from ${h.from.name} → ${h.to.name}` : `Created in ${h.to.name}`}</b>}
      {h.kind === "deleted" && <b>Deleted the lead</b>}
      {h.kind === "updated" && <>
        <b>{h.changes.length === 1 ? `Changed ${FIELD_LABELS[h.changes[0]!.field]?.toLowerCase() ?? h.changes[0]!.field}` : `Changed ${h.changes.length} fields`}</b>
        <ul className="change-list">{h.changes.map((c) => (
          <li key={c.field}><span className="change-field">{FIELD_LABELS[c.field] ?? c.field}</span>
            <span className="change-from">{formatChangeValue(c.field, c.from)}</span><span aria-hidden="true"> → </span><span className="sr-only"> changed to </span>
            <span className="change-to">{formatChangeValue(c.field, c.to)}</span></li>
        ))}</ul>
      </>}
      <small>{formatDateTime(h.at)}{who(h.by)}</small>
    </div></div>
  ))}</div></TabState>;
}
