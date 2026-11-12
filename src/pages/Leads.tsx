import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { FOLLOWUP_FILTERS, LEAD_SORT_FIELDS, TEMPERATURES, type LeadListItemDTO, type LeadListQuery, type LeadSortField } from "@crm/shared";
import FormAlert from "@/components/form/FormAlert";
import { useAppActions } from "@/components/layout/navigation";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import FilterMenu from "@/components/ui/FilterMenu";
import Icon from "@/components/ui/Icon";
import Menu from "@/components/ui/Menu";
import { ageTone, TEMPERATURE_LABELS, temperatureTone } from "@/features/leads/labels";
import { useDeleteLead, useLeadList, useLookups } from "@/features/leads/useLeads";
import { errorMessage } from "@/lib/api";
import { daysSince, formatFollowup, formatMoney, initials, relativeTime } from "@/lib/format";

const PAGE_SIZE = 25;
const ARRAY_KEYS = ["sourceId", "stageId", "temperature", "leadType", "ownerId", "tagId"] as const;
type ArrayKey = (typeof ARRAY_KEYS)[number];
const FOLLOWUP_LABELS: Record<(typeof FOLLOWUP_FILTERS)[number], string> = { overdue: "Overdue", today: "Due today", upcoming: "Upcoming", none: "No follow-up" };

/** The URL is the source of truth for search, filters, sort and page, so views can be shared and survive reloads. */
function useListParams() {
  const [params, setParams] = useSearchParams();
  const query: LeadListQuery = useMemo(() => {
    const q: LeadListQuery = { pageSize: PAGE_SIZE };
    if (params.get("q")) q.q = params.get("q")!;
    for (const key of ARRAY_KEYS) {
      const values = params.getAll(key);
      if (values.length) (q as Record<string, unknown>)[key] = values;
    }
    const followup = params.get("followup");
    if (followup && (FOLLOWUP_FILTERS as readonly string[]).includes(followup)) q.followup = followup as LeadListQuery["followup"];
    const sort = params.get("sort");
    if (sort && (LEAD_SORT_FIELDS as readonly string[]).includes(sort)) q.sort = sort as LeadSortField;
    if (params.get("dir") === "asc" || params.get("dir") === "desc") q.dir = params.get("dir") as "asc" | "desc";
    const page = Number(params.get("page"));
    if (page > 1) q.page = page;
    return q;
  }, [params]);

  const update = (changes: Record<string, string | string[] | undefined>, resetPage = true) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(changes)) {
        next.delete(key);
        if (Array.isArray(value)) value.forEach((v) => next.append(key, v));
        else if (value) next.set(key, value);
      }
      if (resetPage) next.delete("page");
      return next;
    }, { replace: true });
  };
  const clearFilters = () => setParams(new URLSearchParams(), { replace: true });
  const hasFilters = !!query.q || !!query.followup || ARRAY_KEYS.some((k) => (query[k] as string[] | undefined)?.length);
  return { query, update, clearFilters, hasFilters };
}

function SortHeader({ field, label, query, onSort }: { field: LeadSortField; label: string; query: LeadListQuery; onSort: (f: LeadSortField) => void }) {
  const active = (query.sort ?? "createdAt") === field;
  const dir = query.dir ?? "desc";
  return (
    <th aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={`sort-btn ${active ? "active" : ""}`} onClick={() => onSort(field)}>
        {label}<span aria-hidden="true">{active ? (dir === "asc" ? " ↑" : " ↓") : ""}</span>
      </button>
    </th>
  );
}

export default function Leads() {
  const navigate = useNavigate();
  const { openAddLead, openEditLead } = useAppActions();
  const { query, update, clearFilters, hasFilters } = useListParams();
  const lookups = useLookups();
  const leads = useLeadList(query);
  const remove = useDeleteLead();
  const [confirmDelete, setConfirmDelete] = useState<LeadListItemDTO | null>(null);

  // Debounce typing into the URL.
  const [search, setSearch] = useState(query.q ?? "");
  useEffect(() => setSearch(query.q ?? ""), [query.q]);
  useEffect(() => {
    if (search === (query.q ?? "")) return;
    const t = setTimeout(() => update({ q: search.trim() || undefined }), 250);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSort = (field: LeadSortField) => {
    const sameField = (query.sort ?? "createdAt") === field;
    const dir = sameField ? ((query.dir ?? "desc") === "desc" ? "asc" : "desc") : field === "fullName" ? "asc" : "desc";
    update({ sort: field, dir });
  };

  const l = lookups.data;
  const options = {
    sourceId: l?.sources.map((s) => ({ value: s.id, label: s.name })) ?? [],
    stageId: l?.stages.map((s) => ({ value: s.id, label: s.name })) ?? [],
    temperature: TEMPERATURES.map((t) => ({ value: t, label: TEMPERATURE_LABELS[t] })),
    leadType: l?.leadTypes.map((t) => ({ value: t, label: t })) ?? [],
    ownerId: l?.users.map((u) => ({ value: u.id, label: u.name })) ?? [],
    tagId: l?.tags.map((t) => ({ value: t.id, label: t.name })) ?? [],
  } satisfies Record<ArrayKey, { value: string; label: string }[]>;
  const selected = (key: ArrayKey) => (query[key] as string[] | undefined) ?? [];

  const data = leads.data;
  const page = Number(query.page ?? 1);
  const from = data && data.total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = data ? Math.min(page * PAGE_SIZE, data.total) : 0;
  const lastPage = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return <div className="page">
    <div className="page-heading"><div><p className="eyebrow">Sales / All leads</p><h1>Leads</h1><p>Track, qualify, and move your opportunities forward.</p></div><Button icon="plus" onClick={() => openAddLead()}>Add lead</Button></div>
    <div className="view-tabs"><button className="active" aria-current="page"><Icon name="list" size={16}/> List {data && <span>{data.total}</span>}</button><button onClick={() => navigate("/pipeline")}><Icon name="pipeline" size={16}/> Pipeline</button></div>
    <section className="card table-card">
      <div className="table-tools">
        <div className="table-search"><Icon name="search" size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search leads, companies or emails..." aria-label="Search leads"/></div>
        <div className="filters">
          <FilterMenu label="Source" options={options.sourceId} selected={selected("sourceId")} onChange={(v) => update({ sourceId: v })}/>
          <FilterMenu label="Stage" options={options.stageId} selected={selected("stageId")} onChange={(v) => update({ stageId: v })}/>
          <FilterMenu label="Temperature" options={options.temperature} selected={selected("temperature")} onChange={(v) => update({ temperature: v })}/>
          <FilterMenu label="Type" options={options.leadType} selected={selected("leadType")} onChange={(v) => update({ leadType: v })}/>
          <FilterMenu label="Owner" options={options.ownerId} selected={selected("ownerId")} onChange={(v) => update({ ownerId: v })}/>
          <FilterMenu label="Tags" options={options.tagId} selected={selected("tagId")} onChange={(v) => update({ tagId: v })}/>
          <FilterMenu label="Follow-up" single options={FOLLOWUP_FILTERS.map((f) => ({ value: f, label: FOLLOWUP_LABELS[f] }))} selected={query.followup ? [query.followup] : []} onChange={(v) => update({ followup: v[0] })}/>
          {hasFilters && <button type="button" className="text-button clear-filters" onClick={() => { setSearch(""); clearFilters(); }}>Clear all</button>}
        </div>
      </div>

      {leads.isError && <div className="settings-alert"><FormAlert>{errorMessage(leads.error)}</FormAlert></div>}
      {remove.isError && <div className="settings-alert"><FormAlert>{errorMessage(remove.error)}</FormAlert></div>}

      <div className={`table-scroll ${leads.isFetching && !leads.isPending ? "refreshing" : ""}`}><table><thead><tr>
        <SortHeader field="fullName" label="Lead" query={query} onSort={onSort}/><th>Source</th><th>Type</th><th>Temperature</th><th>Stage</th>
        <SortHeader field="valueCents" label="Deal value" query={query} onSort={onSort}/><th>Owner</th>
        <SortHeader field="lastActivityAt" label="Last activity" query={query} onSort={onSort}/>
        <SortHeader field="nextFollowupAt" label="Follow-up" query={query} onSort={onSort}/>
        <SortHeader field="createdAt" label="Lead age" query={query} onSort={onSort}/><th><span className="sr-only">Actions</span></th>
      </tr></thead>
        <tbody>
          {leads.isPending && Array.from({ length: 6 }, (_, i) => <tr key={i} className="skeleton-row"><td colSpan={11}><span/></td></tr>)}
          {data?.items.map((lead) => {
            const followup = formatFollowup(lead.nextFollowupAt);
            const age = daysSince(lead.createdAt);
            return <tr key={lead.id} className={`lead-row border-${lead.temperature}`} onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) navigate(`/leads/${lead.id}`); }}>
              <td><div className="lead-cell"><Avatar initials={initials(lead.fullName)} color={lead.owner?.avatarColor ?? "gray"}/><div><Link to={`/leads/${lead.id}`} className="row-link"><b>{lead.fullName}</b></Link><small>{lead.company ?? "—"}</small></div></div></td>
              <td>{lead.source ? <Badge tone={lead.source.color}>{lead.source.name}</Badge> : <span className="muted">—</span>}</td>
              <td>{lead.leadType ?? <span className="muted">—</span>}</td>
              <td><Badge tone={temperatureTone(lead.temperature)} dot>{TEMPERATURE_LABELS[lead.temperature]}</Badge></td>
              <td><Badge tone={lead.stage.color}>{lead.stage.name}</Badge></td>
              <td><b>{formatMoney(lead.valueCents)}</b></td>
              <td>{lead.owner ? <div className="owner"><Avatar initials={initials(lead.owner.name)} size="sm" color={lead.owner.avatarColor}/>{lead.owner.name.split(" ")[0]}</div> : <span className="muted">Unassigned</span>}</td>
              <td className="muted">{relativeTime(lead.lastActivityAt)}</td>
              <td className={followup.overdue ? "danger-text" : ""}>{followup.label}</td>
              <td><Badge tone={ageTone(age)}>{age >= 14 && "!"} {age} {age === 1 ? "day" : "days"}</Badge></td>
              <td><Menu label={`Actions for ${lead.fullName}`} trigger={<Icon name="more"/>} items={[
                { label: "Open", onSelect: () => navigate(`/leads/${lead.id}`) },
                ...(lead.canEdit ? [{ label: "Edit", onSelect: () => openEditLead(lead.id) }] : []),
                ...(lead.canDelete ? [{ label: "Delete…", danger: true, onSelect: () => setConfirmDelete(lead) }] : []),
              ]}/></td>
            </tr>;
          })}
        </tbody></table>
      </div>
      {data && data.items.length === 0 && (
        <div className="empty-state">
          <b>{hasFilters ? "No leads match these filters" : "No leads yet"}</b>
          <p>{hasFilters ? "Try removing a filter or searching for something else." : "Add your first lead to start tracking your pipeline."}</p>
          {hasFilters ? <Button variant="secondary" onClick={() => { setSearch(""); clearFilters(); }}>Clear filters</Button> : <Button icon="plus" onClick={() => openAddLead()}>Add lead</Button>}
        </div>
      )}
      <div className="table-footer"><span>{data ? (data.total ? `Showing ${from}–${to} of ${data.total} leads` : "0 leads") : "Loading…"}</span><div>
        <Button variant="secondary" onClick={() => update({ page: String(page - 1) }, false)} disabled={page <= 1}>Previous</Button>
        <Button variant="secondary" onClick={() => update({ page: String(page + 1) }, false)} disabled={page >= lastPage}>Next</Button>
      </div></div>
    </section>

    {confirmDelete && (
      <Dialog title={`Delete ${confirmDelete.fullName}?`} description="The lead disappears from lists, the pipeline and reports. Its history is kept, but this can't be undone from the app." onClose={() => setConfirmDelete(null)}
        footer={<><Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="danger" onClick={() => remove.mutate(confirmDelete.id, { onSettled: () => setConfirmDelete(null) })}>Delete lead</Button></>}>
        <span/>
      </Dialog>
    )}
  </div>;
}
