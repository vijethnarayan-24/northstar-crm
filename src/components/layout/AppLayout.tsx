import { Suspense, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useMatch, useNavigate } from "react-router";
import LeadFormDrawer, { type LeadFormTarget } from "@/features/leads/LeadFormDrawer";
import CommandPalette from "@/features/search/CommandPalette";
import TaskDialog from "@/features/tasks/TaskDialog";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import OfflineBanner from "@/components/ui/OfflineBanner";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useLead } from "@/features/leads/useLeads";
import type { View } from "@/types";
import { VIEW_PATHS, viewFromPath, type AppActions } from "./navigation";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function AppLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const view = viewFromPath(pathname);
  const leadMatch = useMatch("/leads/:id");
  const lead = useLead(leadMatch?.params.id);
  const [sidebar, setSidebar] = useState(false);
  const [leadForm, setLeadForm] = useState<LeadFormTarget | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  // Collapsed-to-icons sidebar, remembered per browser (storage can be unavailable; that is fine).
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("crm.sidebarCollapsed") === "1"; } catch { return false; } });
  const toggleCollapsed = () => setCollapsed((c) => { try { localStorage.setItem("crm.sidebarCollapsed", c ? "0" : "1"); } catch { /* ignore */ } return !c; });

  // Ctrl+K / Cmd+K opens search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setView = (v: View) => navigate(v === "detail" ? "/leads" : VIEW_PATHS[v]);
  const actions = useMemo<AppActions>(() => ({
    openAddLead: (stageId) => setLeadForm({ mode: "create", stageId }),
    openEditLead: (id) => setLeadForm({ mode: "edit", id }),
  }), []);
  const title = view === "detail" ? lead.data?.fullName ?? "Lead" : view[0].toUpperCase() + view.slice(1);

  return (
    <div className={`app-shell ${collapsed ? "collapsed" : ""}`}>
      <Sidebar view={view} setView={setView} open={sidebar} close={() => setSidebar(false)} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      {sidebar && <div className="sidebar-shade" onClick={() => setSidebar(false)} />}
      <main className="main">
        <Topbar title={title} onMenu={() => setSidebar(true)} onSearch={() => setSearchOpen(true)} onAddLead={() => setLeadForm({ mode: "create" })} onAddTask={() => setTaskOpen(true)} />
        <OfflineBanner />
        {/* Pages load on demand; a crash in one page shows a recovery screen instead of a blank app. */}
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<PageSkeleton />}>
            <Outlet context={actions} />
          </Suspense>
        </ErrorBoundary>
      </main>
      {leadForm && <LeadFormDrawer target={leadForm} onClose={() => setLeadForm(null)} />}
      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} />}
      {taskOpen && <TaskDialog onClose={() => setTaskOpen(false)} />}
    </div>
  );
}
