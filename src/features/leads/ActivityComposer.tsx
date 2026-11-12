import { useEffect, useRef, useState } from "react";
import { ACTIVITY_TYPES, type ActivityDTO, type ActivityType } from "@crm/shared";
import { useCurrentUser } from "@/auth/useAuth";
import FormAlert from "@/components/form/FormAlert";
import TextField from "@/components/form/TextField";
import Avatar from "@/components/ui/Avatar";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import Icon from "@/components/ui/Icon";
import { useLogActivity, useUpdateActivity } from "@/features/tasks/useTasks";
import { ApiError, errorMessage } from "@/lib/api";
import { fromDateTimeLocal, initials, toDateTimeLocal } from "@/lib/format";
import { ACTIVITY_LABELS } from "./labels";

const PLACEHOLDERS: Record<ActivityType, string> = {
  call: "e.g. Discovery call about the redesign",
  email: "e.g. Sent revised scope and timeline",
  meeting: "e.g. Kickoff workshop with the founders",
  note: "e.g. Budget confirmed between $20–30k",
};

function TypePills({ value, onChange }: { value: ActivityType; onChange: (t: ActivityType) => void }) {
  return (
    <div className="pill-selector activity-types" role="radiogroup" aria-label="Activity type">
      {ACTIVITY_TYPES.map((t) => (
        <button key={t} type="button" role="radio" aria-checked={value === t} className={value === t ? "active" : ""} onClick={() => onChange(t)}>
          <Icon name={ACTIVITY_LABELS[t].icon} size={13} /> {ACTIVITY_LABELS[t].label}
        </button>
      ))}
    </div>
  );
}

/** Collapsed prompt that expands into the log-activity form. */
export default function ActivityComposer({ leadId, open, setOpen }: { leadId: string; open: boolean; setOpen: (open: boolean) => void }) {
  const me = useCurrentUser();
  const log = useLogActivity(leadId);
  const [type, setType] = useState<ActivityType>("call");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [when, setWhen] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [touched, setTouched] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) titleRef.current?.focus(); }, [open]);

  const reset = () => { setTitle(""); setBody(""); setWhen(""); setNextStep(""); setNextDue(""); setTouched(false); log.reset(); };
  const issues = log.error instanceof ApiError ? log.error.issues : {};
  const titleError = touched && !title.trim() ? "Add a short summary" : issues.title?.[0];

  if (!open) return (
    <div className="timeline-compose">
      <Avatar initials={initials(me.name)} color={me.avatarColor} />
      <button type="button" onClick={() => setOpen(true)}>Log a call, email, meeting, or note…</button>
      <Button variant="secondary" icon="plus" onClick={() => setOpen(true)}>Log activity</Button>
    </div>
  );

  const submit = () => {
    setTouched(true);
    if (!title.trim()) return;
    log.mutate(
      { type, title: title.trim(), body, occurredAt: fromDateTimeLocal(when), nextStep, nextStepDueAt: nextStep.trim() ? fromDateTimeLocal(nextDue) : null },
      { onSuccess: () => { reset(); setOpen(false); } },
    );
  };

  return (
    <form className="composer card-inset" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate aria-label="Log activity">
      <TypePills value={type} onChange={setType} />
      {log.isError && !Object.keys(issues).length && <FormAlert>{errorMessage(log.error)}</FormAlert>}
      <TextField ref={titleRef} label="Summary" placeholder={PLACEHOLDERS[type]} value={title} maxLength={200} error={titleError} onChange={(e) => setTitle(e.target.value)} />
      <div className="field">
        <label htmlFor="activity-body">Details (optional)</label>
        <textarea id="activity-body" value={body} maxLength={5000} placeholder="What was discussed, decisions, objections…" onChange={(e) => setBody(e.target.value)} />
      </div>
      <div className="form-grid">
        <TextField label="Next step (optional)" placeholder="e.g. Follow up Friday morning" value={nextStep} maxLength={500} error={issues.nextStep?.[0]} onChange={(e) => setNextStep(e.target.value)} />
        <TextField label="Next step due" type="datetime-local" value={nextDue} disabled={!nextStep.trim()} error={issues.nextStepDueAt?.[0]}
          hint={nextStep.trim() ? (nextDue ? "Creates a task and sets the lead's next follow-up" : "Add a date to turn it into a task") : undefined} onChange={(e) => setNextDue(e.target.value)} />
      </div>
      <details className="composer-more">
        <summary>Happened earlier?</summary>
        <TextField label="When it happened" type="datetime-local" value={when} max={toDateTimeLocal(new Date().toISOString())} error={issues.occurredAt?.[0]} hint="Leave empty for now" onChange={(e) => setWhen(e.target.value)} />
      </details>
      <div className="composer-actions">
        <Button variant="secondary" onClick={() => { reset(); setOpen(false); }}>Cancel</Button>
        <Button type="submit" disabled={log.isPending}>{log.isPending ? "Saving…" : `Log ${ACTIVITY_LABELS[type].label.toLowerCase()}`}</Button>
      </div>
    </form>
  );
}

export function EditActivityDialog({ leadId, activity, onClose }: { leadId: string; activity: ActivityDTO; onClose: () => void }) {
  const update = useUpdateActivity(leadId);
  const [type, setType] = useState<ActivityType>(activity.type);
  const [title, setTitle] = useState(activity.title);
  const [body, setBody] = useState(activity.body ?? "");
  const [nextStep, setNextStep] = useState(activity.nextStep ?? "");
  const [when, setWhen] = useState(toDateTimeLocal(activity.occurredAt));
  const issues = update.error instanceof ApiError ? update.error.issues : {};
  const save = () => title.trim() && update.mutate({ id: activity.id, type, title: title.trim(), body, nextStep, occurredAt: fromDateTimeLocal(when) ?? undefined }, { onSuccess: onClose });

  return (
    <Dialog title="Edit activity" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={update.isPending || !title.trim()} onClick={save}>{update.isPending ? "Saving…" : "Save"}</Button></>}>
      <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        {update.isError && !Object.keys(issues).length && <FormAlert>{errorMessage(update.error)}</FormAlert>}
        <TypePills value={type} onChange={setType} />
        <TextField label="Summary" value={title} maxLength={200} error={!title.trim() ? "Add a short summary" : issues.title?.[0]} onChange={(e) => setTitle(e.target.value)} />
        <div className="field"><label htmlFor="edit-body">Details</label><textarea id="edit-body" value={body} onChange={(e) => setBody(e.target.value)} /></div>
        <TextField label="Next step" value={nextStep} onChange={(e) => setNextStep(e.target.value)} hint="Editing doesn't change any task already created from it." />
        <TextField label="When it happened" type="datetime-local" value={when} error={issues.occurredAt?.[0]} onChange={(e) => setWhen(e.target.value)} />
      </form>
    </Dialog>
  );
}
