import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CALENDAR_KINDS, type CalendarItemDTO, type CalendarKind } from "@crm/shared";
import FormAlert from "@/components/form/FormAlert";
import Avatar from "@/components/ui/Avatar";
import Button from "@/components/ui/Button";
import FilterMenu from "@/components/ui/FilterMenu";
import Icon from "@/components/ui/Icon";
import { useLookups } from "@/features/leads/useLeads";
import { useCalendar } from "@/features/reports/useReports";
import TaskDialog from "@/features/tasks/TaskDialog";
import { errorMessage } from "@/lib/api";
import { initials } from "@/lib/format";
import { SkeletonList } from "@/components/ui/Skeleton";

export const KIND_INFO: Record<CalendarKind, { label: string; plural: string; color: string }> = {
  meeting: { label: "Meeting", plural: "Meetings", color: "var(--violet)" },
  call: { label: "Call", plural: "Calls", color: "var(--green)" },
  email: { label: "Email", plural: "Emails", color: "var(--blue)" },
  note: { label: "Note", plural: "Notes", color: "var(--amber)" },
  task: { label: "Task", plural: "Tasks", color: "var(--accent)" },
  followup: { label: "Follow-up", plural: "Follow-ups", color: "var(--orange)" },
  close: { label: "Expected close", plural: "Expected closes", color: "var(--red)" },
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Local day of an item: all-day items carry a date; timed items an ISO instant. */
const dayOf = (item: CalendarItemDTO) => (item.allDay ? item.at : ymd(new Date(item.at)));
const timeOf = (item: CalendarItemDTO) => (item.allDay ? "All day" : new Date(item.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));

/** Six weeks starting on the Monday on or before the 1st of the month. */
function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export default function Calendar() {
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const today = ymd(new Date());
  const monthParam = params.get("month"); // YYYY-MM
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? new Date(Number(monthParam.slice(0, 4)), Number(monthParam.slice(5)) - 1, 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [selected, setSelected] = useState(today);
  const [adding, setAdding] = useState(false);
  const userId = params.get("person") ?? undefined;
  const kinds = (params.get("kinds")?.split(",").filter((k) => (CALENDAR_KINDS as readonly string[]).includes(k)) ?? []) as CalendarKind[];
  const set = (patch: Record<string, string | undefined>) =>
    setParams((prev) => { const next = new URLSearchParams(prev); for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); } return next; }, { replace: true });

  const days = useMemo(() => monthGrid(month), [month.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const end = new Date(days[41]!.getFullYear(), days[41]!.getMonth(), days[41]!.getDate() + 1);
  const cal = useCalendar({ from: days[0]!.toISOString(), to: end.toISOString(), userId, kinds: kinds.length ? kinds.join(",") : undefined });

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItemDTO[]>();
    for (const item of cal.data ?? []) { const d = dayOf(item); map.set(d, [...(map.get(d) ?? []), item]); }
    return map;
  }, [cal.data]);
  const selectedItems = byDay.get(selected) ?? [];

  const go = (delta: number) => {
    const m = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    set({ month: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}` });
    setSelected(ymd(m.getMonth() === new Date().getMonth() && m.getFullYear() === new Date().getFullYear() ? new Date() : m));
  };
  const goToday = () => { set({ month: undefined }); setSelected(today); };
  const monthTitle = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const selectedTitle = new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return <div className="page calendar-page">
    <div className="page-heading">
      <div><p className="eyebrow">Your work / Schedule</p><h1>Calendar</h1><p>Meetings and calls you logged, task due dates, follow-ups and expected close dates in one place.</p></div>
      <Button icon="plus" onClick={() => setAdding(true)}>Add task</Button>
    </div>

    <div className="calendar-toolbar">
      <div className="calendar-nav">
        <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => go(-1)}><Icon name="chevron" size={16}/></button>
        <h2 aria-live="polite">{monthTitle}</h2>
        <button type="button" className="icon-btn next" aria-label="Next month" onClick={() => go(1)}><Icon name="chevron" size={16}/></button>
        <button type="button" className="text-button" onClick={goToday}>Today</button>
      </div>
      <div className="filters">
        <FilterMenu label="Everyone" single options={lookups.data?.users.map((u) => ({ value: u.id, label: u.name })) ?? []} selected={userId ? [userId] : []} onChange={(v) => set({ person: v[0] })}/>
        <FilterMenu label="Everything" options={CALENDAR_KINDS.map((k) => ({ value: k, label: KIND_INFO[k].plural }))} selected={kinds} onChange={(v) => set({ kinds: v.length ? v.join(",") : undefined })}/>
      </div>
    </div>

    {cal.isError && <FormAlert>{errorMessage(cal.error)}</FormAlert>}

    <div className="calendar-layout">
      <section className={`card calendar-month ${cal.isFetching ? "refreshing" : ""}`} aria-label={monthTitle}>
        <div className="calendar-weekdays" aria-hidden="true">{WEEKDAYS.map((d) => <span key={d}>{d}</span>)}</div>
        <div className="calendar-grid" role="grid" aria-label={`${monthTitle}, choose a day`}>
          {days.map((d) => {
            const key = ymd(d);
            const items = byDay.get(key) ?? [];
            const outside = d.getMonth() !== month.getMonth();
            return <button type="button" role="gridcell" key={key} aria-selected={key === selected}
              className={`calendar-day ${outside ? "outside" : ""} ${key === today ? "today" : ""} ${key === selected ? "selected" : ""}`}
              aria-label={`${d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}: ${items.length ? `${items.length} ${items.length === 1 ? "item" : "items"}` : "nothing scheduled"}`}
              onClick={() => setSelected(key)}>
              <span className="day-number">{d.getDate()}</span>
              <span className="day-items" aria-hidden="true">
                {items.slice(0, 3).map((it) => <span key={it.id} className={`day-chip ${it.done && it.kind === "task" ? "done" : ""}`}><i style={{ background: KIND_INFO[it.kind].color }}/><span>{it.title}</span></span>)}
                {items.length > 3 && <span className="day-more">+{items.length - 3} more</span>}
              </span>
              {items.length > 0 && <span className="day-dots" aria-hidden="true">{items.slice(0, 4).map((it) => <i key={it.id} style={{ background: KIND_INFO[it.kind].color }}/>)}</span>}
            </button>;
          })}
        </div>
        <div className="chart-legend calendar-legend">{CALENDAR_KINDS.map((k) => <span key={k}><i style={{ background: KIND_INFO[k].color }}/>{KIND_INFO[k].label}</span>)}</div>
      </section>

      <section className="card calendar-agenda" aria-live="polite">
        <div className="card-header"><div><h2>{selected === today ? "Today" : selectedTitle}</h2><p>Agenda / {selectedItems.length ? `${selectedItems.length} ${selectedItems.length === 1 ? "item" : "items"}` : "nothing scheduled"}</p></div></div>
        {cal.isPending && <SkeletonList rows={3} avatar={false}/>}
        {!cal.isPending && selectedItems.length === 0 && <p className="empty-note list-note">Nothing on this day.</p>}
        <ol className="agenda-list">{selectedItems.map((it) => <li key={it.id} className={it.done && it.kind === "task" ? "done" : ""}>
          <span className="agenda-time">{timeOf(it)}</span>
          <span className="agenda-kind"><i style={{ background: KIND_INFO[it.kind].color }}/>{KIND_INFO[it.kind].label}{it.kind === "task" && it.done ? " · done" : ""}</span>
          <b>{it.title}</b>
          <span className="agenda-meta">
            {it.lead && <Link to={`/leads/${it.lead.id}`}>{it.lead.fullName}</Link>}
            {it.person && <span className="owner"><Avatar initials={initials(it.person.name)} color={it.person.avatarColor} size="sm"/>{it.person.name}</span>}
          </span>
        </li>)}</ol>
        <p className="report-note">To plan a meeting, add a task or set a lead’s next follow-up; logged meetings and calls show on the day they happened.</p>
      </section>
    </div>
    {adding && <TaskDialog onClose={() => setAdding(false)}/>}
  </div>;
}
