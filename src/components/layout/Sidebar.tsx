import { useNavigate } from "react-router";
import type { View } from "@/types";
import { initialsOf, useCurrentUser, useLogout } from "@/auth/useAuth";
import Avatar from "@/components/ui/Avatar";
import Icon from "@/components/ui/Icon";
import Menu from "@/components/ui/Menu";
import { useMeSummary } from "@/features/tasks/useTasks";
import { useGoal } from "@/features/insights/useInsights";
import { formatMoneyCompact } from "@/lib/format";

export default function Sidebar({ view, setView, open, close, collapsed, onToggleCollapsed }: { view: View; setView: (v: View) => void; open: boolean; close: () => void; collapsed: boolean; onToggleCollapsed: () => void }) {
  const me = useCurrentUser();
  const logout = useLogout();
  const navigate = useNavigate();
  const summary = useMeSummary();
  const links: { label: string; icon: string; view: View }[] = [
    { label: "Dashboard", icon: "grid", view: "dashboard" }, { label: "Leads", icon: "users", view: "leads" },
    { label: "Pipeline", icon: "pipeline", view: "pipeline" }, { label: "Tasks", icon: "check", view: "tasks" },
    { label: "Calendar", icon: "calendar", view: "calendar" }, { label: "Activity", icon: "clock", view: "activity" },
    { label: "Reports", icon: "chart", view: "reports" },
  ];
  return <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
    <div className="brand"><span className="brand-mark" aria-hidden="true">N</span><span>Northstar<span className="brand-muted"> CRM</span></span><button className="icon-btn mobile-only" aria-label="Close navigation" onClick={close}><Icon name="x"/></button></div>
    <nav>
      <div className="nav-caption">Workspace</div>
      {links.map(l => <button key={l.view} className={`nav-link ${view === l.view || (view === "detail" && l.view === "leads") ? "active" : ""}`} title={collapsed ? l.label : undefined} aria-current={view === l.view ? "page" : undefined} onClick={() => { setView(l.view); close(); }}><Icon name={l.icon}/><span>{l.label}</span>{l.view === "tasks" && !!summary.data?.tasksDue && <span className="nav-count" aria-label={`${summary.data.tasksDue} tasks due or overdue`}>{summary.data.tasksDue}</span>}</button>)}
      <div className="nav-caption space-top">Manage</div>
      <button className={`nav-link ${view === "settings" ? "active" : ""}`} title={collapsed ? "Settings" : undefined} aria-current={view === "settings" ? "page" : undefined} onClick={() => { setView("settings"); close(); }}><Icon name="settings"/><span>Settings</span></button>
      <button type="button" className="icon-btn collapse-toggle" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={collapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={onToggleCollapsed}><Icon name="sidebar"/></button>
    </nav>
    <div className="sidebar-bottom">
      <MonthlyGoal isAdmin={me.role === "admin"} onNavigate={(to) => { navigate(to); close(); }}/>
      <div className="user-mini"><Avatar initials={initialsOf(me.name)} color={me.avatarColor}/><div><b>{me.name}</b><small>{me.role === "admin" ? "Workspace admin" : "Member"}</small></div>
        <Menu label="Account menu" align="left" className="menu-up" trigger={<Icon name="more"/>} items={[
          { label: "Profile settings", onSelect: () => { navigate("/settings/profile"); close(); } },
          { label: "Sign out", danger: true, onSelect: () => logout.mutate(undefined, { onSettled: () => navigate("/login", { replace: true }) }) },
        ]}/>
      </div>
    </div>
  </aside>;
}

/** Won value this month against the admin-set target (workspace time zone). */
function MonthlyGoal({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate: (to: string) => void }) {
  const goal = useGoal();
  if (!goal.data) return <div className="storage" aria-busy="true"><div className="storage-title"><span>Monthly goal</span></div><div className="progress"><span style={{ width: 0 }}/></div></div>;
  const { targetCents, wonCents, month } = goal.data;
  const monthName = new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: "long" });
  if (!targetCents) return (
    <div className="storage"><div className="storage-title"><span>{monthName} won</span><b>{formatMoneyCompact(wonCents)}</b></div>
      {isAdmin ? <button type="button" className="text-button" onClick={() => onNavigate("/settings/workspace")}>Set a monthly goal</button> : <small>No goal set for this month</small>}
    </div>
  );
  const pct = Math.round((wonCents / targetCents) * 100);
  return (
    <div className="storage" role="group" aria-label={`Monthly goal: ${pct}% reached`}>
      <div className="storage-title"><span>{monthName} goal</span><b>{pct}%</b></div>
      <div className="progress"><span style={{ width: `${Math.min(100, pct)}%` }}/></div>
      <small>{formatMoneyCompact(wonCents)} of {formatMoneyCompact(targetCents)} won</small>
    </div>
  );
}
