import { useEffect, useState } from "react";
import type { TaskDTO } from "@crm/shared";
import { useCurrentUser } from "@/auth/useAuth";
import FormAlert from "@/components/form/FormAlert";
import TextField from "@/components/form/TextField";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { useLookups } from "@/features/leads/useLeads";
import { ApiError, errorMessage } from "@/lib/api";
import { fromDateTimeLocal, toDateTimeLocal } from "@/lib/format";
import LeadPicker, { type PickedLead } from "./LeadPicker";
import { useCreateTask, useUpdateTask } from "./useTasks";

/** Tomorrow at 9:00 local time, a sensible default due date. */
const tomorrowNine = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toDateTimeLocal(d.toISOString());
};

export default function TaskDialog({ task, lead, defaultAssigneeId, onClose }: {
  task?: TaskDTO;
  /** Fixed lead when adding from a lead's page. */
  lead?: PickedLead;
  defaultAssigneeId?: string;
  onClose: () => void;
}) {
  const me = useCurrentUser();
  const lookups = useLookups();
  const create = useCreateTask();
  const update = useUpdateTask();
  const mutation = task ? update : create;

  const [title, setTitle] = useState(task?.title ?? "");
  const [pickedLead, setPickedLead] = useState<PickedLead | null>(task?.lead ?? lead ?? null);
  // Same rule as the server: anyone can take a task themselves; giving one to someone else
  // needs an admin or the owner of the task's lead.
  const canAssignOthers = me.role === "admin" || (!!pickedLead?.ownerId && pickedLead.ownerId === me.id);
  const allowed = (id: string) => canAssignOthers || id === me.id || (!!task && id === task.assignee.id && pickedLead?.id === task.lead?.id);
  const [assigneeId, setAssigneeId] = useState(() => {
    const wanted = task?.assignee.id ?? defaultAssigneeId ?? me.id;
    return task || me.role === "admin" || wanted === me.id || (lead?.ownerId && lead.ownerId === me.id) ? wanted : me.id;
  });
  // Picking a different lead can take away the right to assign others: fall back to yourself.
  useEffect(() => { if (!allowed(assigneeId)) setAssigneeId(me.id); }, [pickedLead?.id, canAssignOthers]); // eslint-disable-line react-hooks/exhaustive-deps
  const [due, setDue] = useState(task ? toDateTimeLocal(task.dueAt) : tomorrowNine());
  const [touched, setTouched] = useState(false);

  const issues = mutation.error instanceof ApiError ? mutation.error.issues : {};
  const titleError = touched && !title.trim() ? "Task title is required" : issues.title?.[0];
  const generic = mutation.isError && !Object.keys(issues).length ? errorMessage(mutation.error) : null;
  // Keep a deactivated current assignee selectable so editing other fields still works.
  const users = lookups.data?.users ?? [];
  const allOptions = task && !users.some((u) => u.id === task.assignee.id) ? [...users, task.assignee] : users;
  const assigneeOptions = allOptions.filter((u) => allowed(u.id));

  const submit = () => {
    setTouched(true);
    if (!title.trim()) return;
    const body = { title: title.trim(), assigneeId, dueAt: fromDateTimeLocal(due), leadId: pickedLead?.id ?? null };
    if (task) update.mutate({ id: task.id, ...body }, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: onClose });
  };

  return (
    <Dialog title={task ? "Edit task" : "Add task"} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={mutation.isPending} onClick={submit}>{mutation.isPending ? "Saving…" : task ? "Save task" : "Add task"}</Button></>}>
      <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        {generic && <FormAlert>{generic}</FormAlert>}
        <TextField label="Task" placeholder="e.g. Send revised proposal" value={title} maxLength={200} error={titleError} onChange={(e) => setTitle(e.target.value)} />
        {lead && !task ? (
          <div className="field"><span className="field-label">Lead</span><div className="picked-lead"><b>{lead.fullName}</b>{lead.company && <small>{lead.company}</small>}</div></div>
        ) : (
          <LeadPicker value={pickedLead} onChange={setPickedLead} error={issues.leadId?.[0]} />
        )}
        <div className="form-grid">
          <div className={`field ${issues.assigneeId ? "has-error" : ""}`}>
            <label htmlFor="task-assignee">Assigned to</label>
            <select id="task-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              {assigneeOptions.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me.id ? " (you)" : ""}</option>)}
            </select>
            {issues.assigneeId ? <small className="field-error">{issues.assigneeId[0]}</small>
              : !canAssignOthers && <small className="field-hint">Only the lead's owner or an admin can assign this to someone else.</small>}
          </div>
          <TextField label="Due" type="datetime-local" value={due} error={issues.dueAt?.[0]} onChange={(e) => setDue(e.target.value)} hint={due ? undefined : "No due date"} />
        </div>
      </form>
    </Dialog>
  );
}
