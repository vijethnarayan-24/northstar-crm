import { Link } from "react-router";
import type { TaskDTO } from "@crm/shared";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Icon from "@/components/ui/Icon";
import Menu from "@/components/ui/Menu";
import { formatDateTime, formatFollowup, initials, relativeTime } from "@/lib/format";
import { useToggleTask } from "./useTasks";

export function dueBadge(task: TaskDTO) {
  if (task.completedAt) return <Badge tone="green">Done {relativeTime(task.completedAt).toLowerCase()}</Badge>;
  if (!task.dueAt) return <Badge tone="gray">No due date</Badge>;
  const f = formatFollowup(task.dueAt);
  return <Badge tone={f.overdue ? "red" : f.label.startsWith("Today") ? "amber" : "gray"}>{f.label}</Badge>;
}

export default function TaskRow({ task, index, showLead = true, onEdit, onDelete }: { task: TaskDTO; index?: number; showLead?: boolean; onEdit: (t: TaskDTO) => void; onDelete: (t: TaskDTO) => void }) {
  const toggle = useToggleTask();
  const done = !!task.completedAt;
  return (
    <div className={`full-task ${done ? "task-done" : ""}`}>
      {index !== undefined && <span className="num">{String(index + 1).padStart(2, "0")}</span>}
      <button
        type="button"
        className={`check-box ${done ? "checked" : ""}`}
        role="checkbox"
        aria-checked={done}
        aria-label={`${done ? "Reopen" : "Complete"} “${task.title}”`}
        disabled={!task.canEdit || toggle.isPending}
        title={task.canEdit ? undefined : "Only the assignee, creator, lead owner or an admin can change this task"}
        onClick={() => toggle.mutate(task)}
      >{done && <Icon name="check" size={12} />}</button>
      <div className="task-content">
        <b>{task.title}</b>
        <span>
          {showLead && task.lead && <Link to={`/leads/${task.lead.id}`} className="task-lead">{task.lead.fullName}</Link>}
          {task.dueAt && <small title={formatDateTime(task.dueAt)}>{showLead && task.lead ? " · " : ""}{formatDateTime(task.dueAt)}</small>}
        </span>
      </div>
      {dueBadge(task)}
      <Avatar initials={initials(task.assignee.name)} color={task.assignee.avatarColor} />
      {task.canEdit ? <Menu label={`Actions for ${task.title}`} trigger={<Icon name="more" />} items={[
        { label: "Edit", onSelect: () => onEdit(task) },
        { label: "Delete…", danger: true, onSelect: () => onDelete(task) },
      ]} /> : <span className="menu-spacer" />}
      {toggle.isError && <small className="field-error task-error" role="alert">Couldn't save. Try again.</small>}
    </div>
  );
}
