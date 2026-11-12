import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { DASHBOARD_RANGES, type Color, type DashboardRange } from "@crm/shared";
import { useAppActions } from "@/components/layout/navigation";
import { useLeadList } from "@/features/leads/useLeads";
import { useTasks, useToggleTask } from "@/features/tasks/useTasks";
import { useDashboard, useFeed } from "@/features/insights/useInsights";
import FeedItem from "@/features/insights/FeedItem";
import { errorMessage } from "@/lib/api";
import { formatFollowup, formatMoney, formatMoneyCompact, initials } from "@/lib/format";
import { firstName, useCurrentUser } from "@/auth/useAuth";
import FormAlert from "@/components/form/FormAlert";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import StatCard from "@/components/ui/StatCard";
import { SkeletonList } from "@/components/ui/Skeleton";
import { COLOR_VAR } from "@/lib/colors";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};
const RANGE_LABEL: Record<DashboardRange, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days", "365d": "12 months" };
/** CSS colour for each colour token (matches the badge / dot palette). */

/** 0 → "01": row numbers in the editorial style. */
const pad = (i: number) => String(i + 1).padStart(2, "0");


export default function Dashboard() {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const { openAddLead } = useAppActions();
  const [range, setRange] = useState<DashboardRange>("30d");
  const [scope, setScope] = useState<"team" | "me">("team");
  const dash = useDashboard({ range, scope });
  const feed = useFeed({ limit: 6 });
  const overdueTasks = useTasks({ view: "overdue", assigneeId: "me", limit: 5 });
  const todayTasks = useTasks({ view: "today", assigneeId: "me", limit: 5 });
  const toggle = useToggleTask();
  const dueTasks = { isPending: overdueTasks.isPending || todayTasks.isPending, data: overdueTasks.data && todayTasks.data ? [...overdueTasks.data, ...todayTasks.data] : undefined };
  const dueSummary = `${todayTasks.data?.length ?? 0} due today${overdueTasks.data?.length ? `, ${overdueTasks.data.length >= 5 ? "5+" : overdueTasks.data.length} overdue` : ""}`;
  const overdue = useLeadList({ followup: "overdue", sort: "nextFollowupAt", dir: "asc", pageSize: 5, ...(scope === "me" ? { ownerId: [me.id] } : {}) });

  const d = dash.data;
  const k = d?.kpis;
  const period = RANGE_LABEL[range];
  const sourceTotal = d?.bySource.reduce((n, s) => n + s.count, 0) ?? 0;
  // Donut slices as a conic-gradient: each source takes its share of the circle.
  let acc = 0;
  const donut = d && sourceTotal
    ? `conic-gradient(${d.bySource.map((s) => { const from = acc; acc += (s.count / sourceTotal) * 100; return `${COLOR_VAR[s.source?.color ?? "gray"]} ${from}% ${acc}%`; }).join(", ")})`
    : "conic-gradient(var(--surface-3) 0 100%)";
  const maxStage = Math.max(1, ...(d?.byStage.map((s) => s.count) ?? [1]));

  return <div className="page">
    <div className="page-heading"><div><p className="eyebrow">Overview / {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p><h1>{greeting()}, {firstName(me.name)}</h1><p>Here’s what’s happening with {scope === "me" ? "your" : "the team’s"} pipeline.</p></div>
      <div className="dashboard-controls">
        <div className="view-tabs inline" role="group" aria-label="Whose numbers">
          <button className={scope === "team" ? "active" : ""} aria-pressed={scope === "team"} onClick={() => setScope("team")}>Team</button>
          <button className={scope === "me" ? "active" : ""} aria-pressed={scope === "me"} onClick={() => setScope("me")}>Me</button>
        </div>
        <select aria-label="Period" className="range-select" value={range} onChange={(e) => setRange(e.target.value as DashboardRange)}>
          {DASHBOARD_RANGES.map((r) => <option key={r} value={r}>Last {RANGE_LABEL[r]}</option>)}
        </select>
        <Button icon="plus" onClick={() => openAddLead()}>Add lead</Button>
      </div>
    </div>
    {dash.isError && <FormAlert>{errorMessage(dash.error)}</FormAlert>}
    <div className={`stats-grid ${dash.isFetching ? "refreshing" : ""}`}>
      <StatCard label={`New leads · ${period}`} count={k?.newLeads.value} previous={k?.newLeads.previous} periodLabel={period} icon="users" tone="violet"/>
      <StatCard label="Open deals" count={k?.openDeals} note={k ? `${k.hotLeads.value} hot right now` : ""} icon="pipeline" tone="blue"/>
      <StatCard label="Pipeline value" count={k?.pipelineValueCents.value} format={formatMoneyCompact} note="Open deals, right now" icon="money" tone="amber"/>
      <StatCard label={`Win rate · ${period}`} count={k?.winRate.value === null || !k ? undefined : k.winRate.value * 100} format={(n) => `${Math.round(n)}%`}
        note={k && k.winRate.value === null ? "No deals closed yet" : k ? `${k.dealsWon.value} won · ${k.dealsLost.value} lost` : ""}
        change={k && k.winRate.value !== null && k.winRate.previous !== null ? (() => { const pts = Math.round((k.winRate.value! - k.winRate.previous!) * 100); return { text: `${pts > 0 ? "+" : ""}${pts} pts`, positive: pts === 0 ? null : pts > 0 }; })() : null}
        periodLabel={period} icon="trend" tone="green"/>
    </div>
    <div className="dashboard-charts">
      <section className="card chart-card"><div className="card-header"><div><h2>New leads by source</h2><p>Sources / last {period}</p></div><Link className="text-button" to="/leads?sort=createdAt&dir=desc">View leads <Icon name="chevron" size={14}/></Link></div>
        <div className="donut-wrap">
          <div className="donut" style={{ background: donut }} role="img" aria-label={d ? d.bySource.map((s) => `${s.source?.name ?? "No source"}: ${s.count}`).join(", ") : "Loading"}><div><b>{sourceTotal}</b><span>New leads</span></div></div>
          <div className="legend">
            {d?.bySource.length === 0 && <p className="empty-note">No new leads in this period.</p>}
            {d?.bySource.map((s) => <div key={s.source?.id ?? "none"}><span><i className={`legend-dot bg-${s.source?.color ?? "gray"}`}/>{s.source?.name ?? "No source"}</span><b>{s.count}</b></div>)}
          </div>
        </div>
      </section>
      <section className="card chart-card"><div className="card-header"><div><h2>Leads by stage</h2><p>Pipeline / count and value</p></div><button className="text-button" onClick={() => navigate("/pipeline")}>View pipeline <Icon name="chevron" size={14}/></button></div>
        <div className="bars">{d?.byStage.map((s, i) => <Link to={`/leads?stageId=${s.stage.id}`} className="bar-row" key={s.stage.id} title={`${s.count} leads · ${formatMoney(s.valueCents)}`}>
          <span className="num">{pad(i)}</span><span>{s.stage.name}</span><div><i style={{ width: `${(s.count / maxStage) * 100}%`, background: COLOR_VAR[s.stage.color] }}/></div><b>{s.count}</b>
        </Link>)}</div>
      </section>
    </div>
    <div className="dashboard-lists">
      <section className="card list-card"><div className="card-header"><div><h2>Overdue follow-ups</h2><p>Follow-ups / {scope === "me" ? "your leads" : "across the team"}</p></div>{overdue.data && <Badge tone={overdue.data.total ? "red" : "green"}>{overdue.data.total ? `${overdue.data.total} overdue` : "All caught up"}</Badge>}</div>
        {overdue.isPending && <SkeletonList rows={3}/>}
        {overdue.data?.items.length === 0 && <p className="empty-note list-note">No overdue follow-ups. Nice work.</p>}
        {overdue.data?.items.map((l, i) => <Link className="compact-row" key={l.id} to={`/leads/${l.id}`}><span className={`temp-line temp-${l.temperature}`}/><span className="num">{pad(i)}</span><Avatar initials={initials(l.fullName)} color={l.owner?.avatarColor ?? "gray"}/><div><b>{l.fullName}</b><small>{l.company ?? "—"}</small></div>{l.source && <Badge tone={l.source.color}>{l.source.name}</Badge>}<span className="grow"/><span className="overdue"><Icon name="clock" size={14}/> {formatFollowup(l.nextFollowupAt).label}</span></Link>)}
        {overdue.data && overdue.data.total > overdue.data.items.length && <Link className="text-button list-more" to="/leads?followup=overdue&sort=nextFollowupAt&dir=asc">View all {overdue.data.total} <Icon name="chevron" size={14}/></Link>}
      </section>
      <section className="card list-card"><div className="card-header"><div><h2>Today&rsquo;s tasks</h2><p>Your work / {dueTasks.isPending ? "loading…" : dueSummary}</p></div><button className="text-button" onClick={() => navigate("/tasks")}>View all <Icon name="chevron" size={14}/></button></div>
        {dueTasks.data?.length === 0 && <p className="empty-note list-note">Nothing due today. Plan ahead from the Tasks page.</p>}
        {dueTasks.data?.slice(0, 5).map((t, i) => <div className="task-row" key={t.id}>
          <span className="num">{pad(i)}</span>
          <button type="button" className={`check-box ${t.completedAt ? "checked" : ""}`} role="checkbox" aria-checked={!!t.completedAt} aria-label={`Complete “${t.title}”`} disabled={!t.canEdit} onClick={() => toggle.mutate(t)}>{t.completedAt && <Icon name="check" size={12}/>}</button>
          <div><b className={t.completedAt ? "struck" : ""}>{t.title}</b><small>{t.lead ? <Link to={`/leads/${t.lead.id}`} className="task-lead">{t.lead.fullName}</Link> : "No lead"} · <span className={formatFollowup(t.dueAt).overdue && !t.completedAt ? "danger-text" : ""}>{formatFollowup(t.dueAt).label}</span></small></div>
        </div>)}
      </section>
    </div>
    <section className="card activity-card"><div className="card-header"><div><h2>Recent activity</h2><p>Workspace / latest updates</p></div><Link className="text-button" to="/activity">All activity <Icon name="chevron" size={14}/></Link></div>
      {feed.isPending && <SkeletonList rows={4}/>}
      {feed.data?.pages[0]?.events.length === 0 && <p className="empty-note list-note">Nothing has happened yet.</p>}
      <div className="activity-grid">{feed.data?.pages[0]?.events.map((e) => <FeedItem key={e.id} event={e} compact/>)}</div>
    </section>
  </div>;
}
