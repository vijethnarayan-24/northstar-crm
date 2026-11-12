import { useSearchParams } from "react-router";
import { LOST_REASONS, type ReportQuery } from "@crm/shared";
import FormAlert from "@/components/form/FormAlert";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import FilterMenu from "@/components/ui/FilterMenu";
import Icon from "@/components/ui/Icon";
import StatCard from "@/components/ui/StatCard";
import { LOST_REASON_LABELS } from "@/features/leads/labels";
import { useLookups } from "@/features/leads/useLeads";
import { closedDealsCsvUrl, useReports } from "@/features/reports/useReports";
import { errorMessage } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { formatMoney, formatMoneyCompact, initials } from "@/lib/format";
import { COLOR_VAR } from "@/lib/colors";

/** YYYY-MM-DD in the browser's time zone. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };

const PRESETS = [
  { value: "30d", label: "Last 30 days", range: () => ({ from: daysAgo(29), to: ymd(new Date()) }) },
  { value: "90d", label: "Last 90 days", range: () => ({ from: daysAgo(89), to: ymd(new Date()) }) },
  { value: "quarter", label: "This quarter", range: () => { const d = new Date(); return { from: ymd(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)), to: ymd(d) }; } },
  { value: "year", label: "This year", range: () => ({ from: `${new Date().getFullYear()}-01-01`, to: ymd(new Date()) }) },
  { value: "lastyear", label: "Last year", range: () => { const y = new Date().getFullYear() - 1; return { from: `${y}-01-01`, to: `${y}-12-31` }; } },
  { value: "custom", label: "Custom dates", range: () => ({ from: daysAgo(89), to: ymd(new Date()) }) },
] as const;
type Preset = (typeof PRESETS)[number]["value"];

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const days = (v: number | null) => (v === null ? "—" : `${v} ${v === 1 ? "day" : "days"}`);
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Numbered section header in the house style: label above, title below. */
function SectionHead({ n, label, title, children }: { n: string; label: string; title: string; children?: React.ReactNode }) {
  return <div className="card-header"><div><h2>{title}</h2><p>{n} / {label}</p></div>{children}</div>;
}

export default function Reports() {
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const preset = (PRESETS.find((p) => p.value === params.get("range"))?.value ?? "90d") as Preset;
  const base = PRESETS.find((p) => p.value === preset)!.range();
  const query: ReportQuery = {
    from: preset === "custom" ? params.get("from") ?? base.from : base.from,
    to: preset === "custom" ? params.get("to") ?? base.to : base.to,
    ownerId: params.get("owner") ?? undefined,
    sourceId: params.get("source") ?? undefined,
  };
  const set = (patch: Record<string, string | undefined>) =>
    setParams((prev) => { const next = new URLSearchParams(prev); for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); } return next; }, { replace: true });

  const report = useReports(query);
  const r = report.data;
  const s = r?.summary;
  const rangeText = r ? `${longDate(r.range.from)} – ${longDate(r.range.to)}` : "";
  const fileTag = r ? `${r.range.from}-to-${r.range.to}` : "report";

  const reasonTotal = r?.lostReasons.reduce((n, x) => n + x.count, 0) ?? 0;
  const maxMonth = Math.max(1, ...(r?.monthly.flatMap((m) => [m.won, m.lost]) ?? [1]));
  const maxBucket = Math.max(1, ...(r?.cycleBuckets.map((b) => b.count) ?? [1]));
  const ownerName = lookups.data?.users.find((u) => u.id === query.ownerId)?.name;
  const sourceName = lookups.data?.sources.find((x) => x.id === query.sourceId)?.name;

  return <div className="page reports-page">
    <div className="page-heading">
      <div><p className="eyebrow">Insights / Reports</p><h1>Reports</h1><p>How deals are being won and lost, where the best leads come from, and how long they take to close.</p></div>
      <div className="report-actions no-print">
        <Button variant="secondary" icon="printer" onClick={() => window.print()}>Save as PDF</Button>
        <a className="btn btn-primary" href={closedDealsCsvUrl(query)} download><Icon name="download" size={16}/> Export closed deals (CSV)</a>
      </div>
    </div>

    <div className="report-toolbar no-print">
      <select aria-label="Period" className="range-select" value={preset} onChange={(e) => set({ range: e.target.value, ...(e.target.value === "custom" ? { from: query.from, to: query.to } : { from: undefined, to: undefined }) })}>
        {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      {preset === "custom" && <div className="date-range">
        <label><span className="sr-only">From</span><input type="date" value={query.from} max={query.to} onChange={(e) => e.target.value && set({ from: e.target.value })}/></label>
        <span aria-hidden="true">→</span>
        <label><span className="sr-only">To</span><input type="date" value={query.to} min={query.from} onChange={(e) => e.target.value && set({ to: e.target.value })}/></label>
      </div>}
      <div className="filters">
        <FilterMenu label="All owners" single options={lookups.data?.users.map((u) => ({ value: u.id, label: u.name })) ?? []} selected={query.ownerId ? [query.ownerId] : []} onChange={(v) => set({ owner: v[0] })}/>
        <FilterMenu label="All sources" single options={lookups.data?.sources.map((x) => ({ value: x.id, label: x.name })) ?? []} selected={query.sourceId ? [query.sourceId] : []} onChange={(v) => set({ source: v[0] })}/>
      </div>
    </div>

    {/* Shown on the printed PDF instead of the controls above. */}
    <p className="print-only report-print-meta">{rangeText}{ownerName ? ` · Owner: ${ownerName}` : ""}{sourceName ? ` · Source: ${sourceName}` : ""} · Printed {new Date().toLocaleDateString()}</p>

    {report.isError && <FormAlert>{errorMessage(report.error)}</FormAlert>}

    <div className={`stats-grid report-kpis ${report.isFetching ? "refreshing" : ""}`}>
      <StatCard label="Won" count={s?.wonCents} format={formatMoneyCompact} note={s ? `${s.won} ${s.won === 1 ? "deal" : "deals"} · avg ${s.avgDealCents === null ? "—" : formatMoneyCompact(s.avgDealCents)}` : ""} icon="money" tone="green"/>
      <StatCard label="Win rate" count={s?.winRate === null || !s ? undefined : s.winRate * 100} format={(n) => `${Math.round(n)}%`} note={s ? (s.winRate === null ? "No deals closed in this period" : `${s.won} won · ${s.lost} lost`) : ""} icon="trend" tone="violet"/>
      <StatCard label="Sales cycle (median)" count={s?.medianCycleDays ?? undefined} format={(n) => `${Math.round(n)}d`} note={s ? (s.medianCycleDays === null ? "No deals won yet" : `Average ${days(s.avgCycleDays)}`) : ""} icon="clock" tone="amber"/>
      <StatCard label="Lost" count={s?.lostCents} format={formatMoneyCompact} note={s ? `${s.lost} ${s.lost === 1 ? "deal" : "deals"} · ${s.created} new leads` : ""} icon="flame" tone="red"/>
    </div>

    <div className="report-grid">
      <section className="card report-card">
        <SectionHead n="01" label="Win / loss by month" title="Deals closed">
          <button className="text-button no-print" disabled={!r} onClick={() => r && downloadCsv(`win-loss-by-month-${fileTag}.csv`, ["Month", "Won", "Lost", "Won value"], r.monthly.map((m) => [m.month, m.won, m.lost, (m.wonCents / 100).toFixed(2)]))}>CSV</button>
        </SectionHead>
        <div className="month-bars" role="img" aria-label={r ? r.monthly.map((m) => `${monthLabel(m.month)}: ${m.won} won, ${m.lost} lost`).join("; ") : "Loading"}>
          {r?.monthly.map((m) => <div className="month-col" key={m.month} title={`${monthLabel(m.month)}: ${m.won} won (${formatMoney(m.wonCents)}), ${m.lost} lost`}>
            <div className="month-pair"><i className="bar-won" style={{ height: `${(m.won / maxMonth) * 100}%` }}/><i className="bar-lost" style={{ height: `${(m.lost / maxMonth) * 100}%` }}/></div>
            <span>{monthLabel(m.month)}</span>
          </div>)}
        </div>
        <div className="chart-legend"><span><i className="bar-won"/>Won</span><span><i className="bar-lost"/>Lost</span></div>
      </section>

      <section className="card report-card">
        <SectionHead n="02" label="Why deals were lost" title="Lost reasons">
          <button className="text-button no-print" disabled={!r} onClick={() => r && downloadCsv(`lost-reasons-${fileTag}.csv`, ["Reason", "Deals", "Share", "Value"], r.lostReasons.map((x) => [LOST_REASON_LABELS[x.reason], x.count, pct(x.count / Math.max(1, reasonTotal)), (x.valueCents / 100).toFixed(2)]))}>CSV</button>
        </SectionHead>
        {r && reasonTotal === 0 && <p className="empty-note list-note">No deals were lost in this period.</p>}
        <div className="bars">{r?.lostReasons.map((x, i) => <div className="bar-row" key={x.reason} title={`${x.count} deals · ${formatMoney(x.valueCents)}`}>
          <span className="num">{String(i + 1).padStart(2, "0")}</span><span>{LOST_REASON_LABELS[x.reason]}</span>
          <div><i style={{ width: `${(x.count / reasonTotal) * 100}%`, background: "var(--red)" }}/></div><b>{x.count} <small>{pct(x.count / reasonTotal)}</small></b>
        </div>)}</div>
        {r && reasonTotal > 0 && <p className="report-note">Top reason: <b>{LOST_REASON_LABELS[r.lostReasons[0]!.reason]}</b> ({pct(r.lostReasons[0]!.count / reasonTotal)} of lost deals, {formatMoney(r.lostReasons[0]!.valueCents)}). Reasons with no losses aren’t shown; the full list is {LOST_REASONS.map((x) => LOST_REASON_LABELS[x]).join(", ")}.</p>}
      </section>
    </div>

    <section className="card report-card report-wide">
      <SectionHead n="03" label="Leads created in the period, by source" title="Source performance">
        <button className="text-button no-print" disabled={!r} onClick={() => r && downloadCsv(`source-performance-${fileTag}.csv`, ["Source", "Leads", "Won", "Lost", "Still open", "Conversion", "Won value", "Avg days to close"], r.sources.map((x) => [x.source?.name ?? "No source", x.created, x.won, x.lost, x.open, pct(x.conversion), (x.wonCents / 100).toFixed(2), x.avgCycleDays ?? ""]))}>CSV</button>
      </SectionHead>
      <div className="table-scroll"><table className="report-table">
        <thead><tr><th>Source</th><th className="numeric">Leads</th><th className="numeric">Won</th><th className="numeric">Lost</th><th className="numeric">Still open</th><th className="numeric">Conversion</th><th className="numeric">Won value</th><th className="numeric">Avg. days to close</th></tr></thead>
        <tbody>
          {r?.sources.length === 0 && <tr><td colSpan={8} className="empty-cell">No leads were created in this period.</td></tr>}
          {r?.sources.map((x) => <tr key={x.source?.id ?? "none"}>
            <td>{x.source ? <Badge tone={x.source.color}>{x.source.name}</Badge> : <span className="muted">No source</span>}</td>
            <td className="numeric">{x.created}</td><td className="numeric">{x.won}</td><td className="numeric">{x.lost}</td><td className="numeric">{x.open}</td>
            <td className="numeric"><span className="conversion"><i style={{ width: `${(x.conversion ?? 0) * 100}%`, background: COLOR_VAR[x.source?.color ?? "gray"] }}/></span>{pct(x.conversion)}</td>
            <td className="numeric">{formatMoney(x.wonCents)}</td><td className="numeric">{days(x.avgCycleDays)}</td>
          </tr>)}
        </tbody>
      </table></div>
      <p className="report-note">Conversion = leads from that source that were won, out of all leads it brought in during the period. Open leads may still convert.</p>
    </section>

    <div className="report-grid">
      <section className="card report-card">
        <SectionHead n="04" label="Days from new lead to won" title="Sales cycle">
          <button className="text-button no-print" disabled={!r} onClick={() => r && downloadCsv(`sales-cycle-${fileTag}.csv`, ["Days to close", "Deals won"], r.cycleBuckets.map((b) => [b.label, b.count]))}>CSV</button>
        </SectionHead>
        <div className="bars">{r?.cycleBuckets.map((b, i) => <div className="bar-row" key={b.label}>
          <span className="num">{String(i + 1).padStart(2, "0")}</span><span>{b.label}</span>
          <div><i style={{ width: `${(b.count / maxBucket) * 100}%`, background: "var(--amber)" }}/></div><b>{b.count}</b>
        </div>)}</div>
        {s && <p className="report-note">{s.won ? <>Half of the deals won closed within <b>{days(s.medianCycleDays)}</b>; the average was {days(s.avgCycleDays)}.</> : "No deals were won in this period."}</p>}
      </section>

      <section className="card report-card">
        <SectionHead n="05" label="Deals closed in the period, by owner" title="By owner">
          <button className="text-button no-print" disabled={!r} onClick={() => r && downloadCsv(`by-owner-${fileTag}.csv`, ["Owner", "Won", "Lost", "Win rate", "Won value", "Avg days to close"], r.owners.map((o) => [o.owner?.name ?? "Unassigned", o.won, o.lost, pct(o.winRate), (o.wonCents / 100).toFixed(2), o.avgCycleDays ?? ""]))}>CSV</button>
        </SectionHead>
        <div className="table-scroll"><table className="report-table">
          <thead><tr><th>Owner</th><th className="numeric">Won</th><th className="numeric">Lost</th><th className="numeric">Win rate</th><th className="numeric">Won value</th></tr></thead>
          <tbody>
            {r?.owners.length === 0 && <tr><td colSpan={5} className="empty-cell">No deals closed in this period.</td></tr>}
            {r?.owners.map((o) => <tr key={o.owner?.id ?? "none"}>
              <td><span className="owner">{o.owner ? <><Avatar initials={initials(o.owner.name)} color={o.owner.avatarColor} size="sm"/>{o.owner.name}</> : <span className="muted">Unassigned</span>}</span></td>
              <td className="numeric">{o.won}</td><td className="numeric">{o.lost}</td><td className="numeric">{pct(o.winRate)}</td><td className="numeric">{formatMoney(o.wonCents)}</td>
            </tr>)}
          </tbody>
        </table></div>
      </section>
    </div>
    <p className="report-note report-footnote">Times use the workspace time zone{r ? ` (${r.range.timezone})` : ""}. Won and lost count deals by the date they were closed; deleted leads are left out.</p>
  </div>;
}
