import { Link } from "react-router";
import { initialsOf, useCurrentUser } from "@/auth/useAuth";
import Avatar from "@/components/ui/Avatar";
import Icon from "@/components/ui/Icon";
import Menu from "@/components/ui/Menu";
import ThemeToggle from "@/components/ui/ThemeToggle";
import NotificationBell from "@/features/notifications/NotificationBell";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export default function Topbar({ title, onMenu, onSearch, onAddLead, onAddTask }: { title: string; onMenu: () => void; onSearch: () => void; onAddLead: () => void; onAddTask: () => void }) {
  const me = useCurrentUser();
  return <header className="topbar">
    <button className="icon-btn mobile-only" aria-label="Open navigation" onClick={onMenu}><Icon name="menu"/></button>
    <div className="breadcrumbs"><span>Workspace</span><Icon name="chevron" size={14}/><b>{title}</b></div>
    <div className="top-actions">
      <button type="button" className="global-search" onClick={onSearch} aria-label="Search (Ctrl+K)" aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}>
        <Icon name="search" size={16}/><span>Search anything...</span><kbd>{isMac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      <button type="button" className="icon-btn mobile-search" aria-label="Search" onClick={onSearch}><Icon name="search"/></button>
      <Menu label="Quick add" className="quick-add" trigger={<Icon name="plus"/>} items={[
        { label: "New lead", onSelect: onAddLead },
        { label: "New task", onSelect: onAddTask },
      ]}/>
      <ThemeToggle/>
      <NotificationBell/>
      <Link to="/settings/profile" aria-label={`${me.name} – profile settings`} className="avatar-link"><Avatar initials={initialsOf(me.name)} color={me.avatarColor}/></Link>
    </div>
  </header>;
}
