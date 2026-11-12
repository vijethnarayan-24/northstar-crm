import { NavLink, Navigate, useParams } from "react-router";
import SourcesSettings from "@/features/settings/SourcesSettings";
import StagesSettings from "@/features/settings/StagesSettings";
import TagsSettings from "@/features/settings/TagsSettings";
import GoalSettings from "@/features/settings/GoalSettings";
import WorkspaceSettings from "@/features/settings/WorkspaceSettings";
import NotificationSettings from "@/features/notifications/NotificationSettings";
import ProfileSettings from "@/features/team/ProfileSettings";
import TeamSettings from "@/features/team/TeamSettings";
import SystemStatus from "@/features/settings/SystemStatus";
import { useCurrentUser } from "@/auth/useAuth";

const TABS = [
  { slug: "profile", label: "Profile", Component: ProfileSettings },
  { slug: "team", label: "Team members", Component: TeamSettings },
  { slug: "workspace", label: "Workspace", Component: WorkspaceTab },
  { slug: "sources", label: "Lead sources", Component: SourcesSettings },
  { slug: "stages", label: "Pipeline stages", Component: StagesSettings },
  { slug: "tags", label: "Tags", Component: TagsSettings },
  { slug: "notifications", label: "Notifications", Component: NotificationSettings },
  { slug: "system", label: "System status", Component: SystemStatus, adminOnly: true },
] as const;

function WorkspaceTab() {
  return <><WorkspaceSettings/><GoalSettings/></>;
}

export default function Settings() {
  const { tab } = useParams();
  const isAdmin = useCurrentUser().role === "admin";
  const tabs = TABS.filter((t) => !("adminOnly" in t && t.adminOnly) || isAdmin);
  const current = tabs.find((t) => t.slug === tab);
  if (!current) return <Navigate to="/settings/team" replace />;
  const { Component } = current;

  return <div className="page"><div className="page-heading"><div><p className="eyebrow">Workspace / Configuration</p><h1>Settings</h1><p>Manage your team, pipeline, and workspace preferences.</p></div></div>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">{tabs.map(t => <NavLink to={`/settings/${t.slug}`} className={({ isActive }) => isActive ? "active" : ""} key={t.slug}>{t.label}</NavLink>)}</nav>
      <div className="settings-content"><Component/></div>
    </div>
  </div>;
}
