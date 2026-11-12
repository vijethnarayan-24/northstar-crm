import { useSearchParams } from "react-router";
import type { EventType, FeedEventDTO } from "@crm/shared";
import FormAlert from "@/components/form/FormAlert";
import Button from "@/components/ui/Button";
import FilterMenu from "@/components/ui/FilterMenu";
import FeedItem, { FEED_TYPE_GROUPS } from "@/features/insights/FeedItem";
import { useFeed } from "@/features/insights/useInsights";
import { useLookups } from "@/features/leads/useLeads";
import { errorMessage } from "@/lib/api";
import { SkeletonList } from "@/components/ui/Skeleton";

/** "Today", "Yesterday", or a date, for grouping the feed by day. */
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 864e5);
  return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
};

export default function Activity() {
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const actorId = params.get("person") ?? undefined;
  const group = FEED_TYPE_GROUPS.find((g) => g.label === params.get("type"));
  const feed = useFeed({ limit: 30, actorId, type: group?.types as EventType[] | undefined });
  const set = (key: string, value?: string) => setParams((prev) => { const next = new URLSearchParams(prev); if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true });

  const events = feed.data?.pages.flatMap((p) => p.events) ?? [];
  const byDay: [string, FeedEventDTO[]][] = [];
  for (const e of events) {
    const label = dayLabel(e.createdAt);
    if (byDay.at(-1)?.[0] === label) byDay.at(-1)![1].push(e);
    else byDay.push([label, [e]]);
  }

  return <div className="page">
    <div className="page-heading"><div><p className="eyebrow">Workspace / Timeline</p><h1>Activity</h1><p>Everything that happened across leads, the pipeline and tasks.</p></div></div>
    <section className="card">
      <div className="card-header">
        <div><h2>Timeline</h2><p>Newest first · updates every minute</p></div>
        <div className="filters">
          <FilterMenu label="Everyone" single options={lookups.data?.users.map((u) => ({ value: u.id, label: u.name })) ?? []} selected={actorId ? [actorId] : []} onChange={(v) => set("person", v[0])}/>
          <FilterMenu label="All types" single options={FEED_TYPE_GROUPS.map((g) => ({ value: g.label, label: g.label }))} selected={group ? [group.label] : []} onChange={(v) => set("type", v[0])}/>
        </div>
      </div>
      {feed.isError && <div className="settings-alert"><FormAlert>{errorMessage(feed.error)}</FormAlert></div>}
      {feed.isPending && <SkeletonList rows={6}/>}
      {!feed.isPending && events.length === 0 && <div className="empty-state"><b>No activity matches these filters</b></div>}
      <div className="feed">
        {byDay.map(([day, items]) => <div key={day} className="feed-day"><h3>{day}</h3>{items.map((e) => <FeedItem key={e.id} event={e}/>)}</div>)}
      </div>
      {feed.hasNextPage && <div className="feed-more"><Button variant="secondary" disabled={feed.isFetchingNextPage} onClick={() => feed.fetchNextPage()}>{feed.isFetchingNextPage ? "Loading…" : "Load older activity"}</Button></div>}
    </section>
  </div>;
}
