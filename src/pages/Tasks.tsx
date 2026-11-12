import { useState } from "react";
import { useSearchParams } from "react-router";
import type { TaskDTO, TaskView } from "@crm/shared";
import { useCurrentUser } from "@/auth/useAuth";
import FormAlert from "@/components/form/FormAlert";
import Button from "@/components/ui/Button";
import FilterMenu from "@/components/ui/FilterMenu";
import { useLookups } from "@/features/leads/useLeads";
import { ConfirmDialog } from "@/features/settings/SettingsParts";
import TaskDialog from "@/features/tasks/TaskDialog";
import TaskRow from "@/features/tasks/TaskRow";
import { useDeleteTask, useTasks, useTaskStats } from "@/features/tasks/useTasks";
import { errorMessage } from "@/lib/api";

const VIEWS: { view: TaskView; label: string; empty: string }[] = [
  { view: "overdue", label: "Overdue", empty: "Nothing overdue. Nice work." },
  { view: "today", label: "Today", empty: "Nothing due today." },
  { view: "upcoming", label: "Upcoming", empty: "No upcoming tasks." },
  { view: "completed", label: "Completed", empty: "No completed tasks yet." },
];

export default function Tasks() {
  const me = useCurrentUser();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.find((v) => v.view === params.get("view"))?.view ?? "today") as TaskView;
  // "me" (default), "all", or a user id
  const assignee = params.get("assignee") ?? "me";
  const assigneeId = assignee === "all" ? undefined : assignee;
  const set = (key: string, value: string) => setParams((prev) => { const next = new URLSearchParams(prev); next.set(key, value); return next; }, { replace: true });

  const stats = useTaskStats(assigneeId);
  const tasks = useTasks({ view, assigneeId, limit: view === "completed" ? 100 : 200 });
  const remove = useDeleteTask();
  const [dialog, setDialog] = useState<{ task?: TaskDTO } | null>(null);
  const [deleting, setDeleting] = useState<TaskDTO | null>(null);

  const count = (v: TaskView) => stats.data ? { overdue: stats.data.overdue, today: stats.data.dueToday, upcoming: stats.data.upcoming, completed: stats.data.completedThisWeek, open: 0 }[v] : undefined;
  const assigneeOptions = [{ value: "me", label: "My tasks" }, { value: "all", label: "Everyone" }, ...(lookups.data?.users.filter((u) => u.id !== me.id).map((u) => ({ value: u.id, label: u.name })) ?? [])];
  const current = VIEWS.find((v) => v.view === view)!;

  return <div className="page"><div className="page-heading"><div><p className="eyebrow">Your work / Next steps</p><h1>Tasks</h1><p>Stay on top of every next step and follow-up.</p></div><Button icon="plus" onClick={() => setDialog({})}>Add task</Button></div>
    <div className="task-stats">
      <button type="button" className={`card stat-button ${view === "today" ? "active" : ""}`} onClick={() => set("view", "today")}><b>{stats.data?.dueToday ?? "–"}</b><span>Due today</span></button>
      <button type="button" className={`card stat-button ${view === "overdue" ? "active" : ""}`} onClick={() => set("view", "overdue")}><b className={stats.data?.overdue ? "danger-text" : ""}>{stats.data?.overdue ?? "–"}</b><span>Overdue</span></button>
      <button type="button" className={`card stat-button ${view === "completed" ? "active" : ""}`} onClick={() => set("view", "completed")}><b className="positive">{stats.data?.completedThisWeek ?? "–"}</b><span>Completed in the last 7 days</span></button>
    </div>
    <section className="card tasks-panel">
      <div className="card-header">
        <div className="view-tabs inline task-views" role="tablist" aria-label="Task views">
          {VIEWS.map((v) => <button key={v.view} role="tab" aria-selected={view === v.view} className={view === v.view ? "active" : ""} onClick={() => set("view", v.view)}>
            {v.label}{count(v.view) !== undefined && <span>{count(v.view)}</span>}
          </button>)}
        </div>
        <FilterMenu label="Assignee" single options={assigneeOptions} selected={[assignee]} onChange={(v) => set("assignee", v[0] ?? "me")}/>
      </div>
      {tasks.isError && <div className="settings-alert"><FormAlert>{errorMessage(tasks.error)}</FormAlert></div>}
      {tasks.isPending && <p className="empty-note list-note">Loading tasks…</p>}
      {tasks.data?.length === 0 && <div className="empty-state"><b>{current.empty}</b>{view !== "completed" && <Button variant="secondary" icon="plus" onClick={() => setDialog({})}>Add task</Button>}</div>}
      {tasks.data?.map((t, i) => <TaskRow key={t.id} task={t} index={i} onEdit={(task) => setDialog({ task })} onDelete={setDeleting}/>)}
      {view === "completed" && (tasks.data?.length ?? 0) >= 100 && <p className="muted-note list-note">Showing the 100 most recently completed.</p>}
    </section>

    {dialog && <TaskDialog task={dialog.task} defaultAssigneeId={assigneeId && assigneeId !== "me" ? assigneeId : undefined} onClose={() => setDialog(null)}/>}
    {deleting && <ConfirmDialog title="Delete this task?" description={`“${deleting.title}” will be removed.`} confirmLabel="Delete task" pending={remove.isPending} error={remove.error}
      onClose={() => { setDeleting(null); remove.reset(); }} onConfirm={() => remove.mutate(deleting, { onSuccess: () => setDeleting(null) })}/>}
  </div>;
}
