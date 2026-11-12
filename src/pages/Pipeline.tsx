import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { LeadListItemDTO, PipelineColumnDTO } from "@crm/shared";
import FormAlert from "@/components/form/FormAlert";
import { useAppActions } from "@/components/layout/navigation";
import Button from "@/components/ui/Button";
import FilterMenu from "@/components/ui/FilterMenu";
import Icon from "@/components/ui/Icon";
import LostDialog from "@/features/leads/LostDialog";
import { useBoardMove, useLookups, usePipeline } from "@/features/leads/useLeads";
import BoardCard, { CardBody } from "@/features/pipeline/BoardCard";
import { errorMessage } from "@/lib/api";
import { formatMoneyCompact } from "@/lib/format";

type Columns = Record<string, string[]>; // stageId → ordered lead ids

const CLOSED_WINDOWS = [
  { value: "30", label: "Closed in 30 days" },
  { value: "90", label: "Closed in 90 days" },
  { value: "365", label: "Closed in a year" },
];

function Column({ column, ids, leadsById, onAdd }: { column: PipelineColumnDTO; ids: string[]; leadsById: Map<string, LeadListItemDTO>; onAdd: () => void }) {
  const { stage } = column;
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  // Server totals cover the whole column (it may be truncated); adjust them by cards moved in or out locally.
  const value = (list: string[]) => list.reduce((sum, id) => sum + (leadsById.get(id)?.valueCents ?? 0), 0);
  const serverIds = column.leads.map((l) => l.id);
  const count = column.count + ids.length - serverIds.length;
  const total = column.totalCents + value(ids) - value(serverIds);
  const hidden = column.count - serverIds.length;
  return (
    <section className={`kanban-column ${isOver ? "is-over" : ""}`} aria-label={`${stage.name}: ${count} ${count === 1 ? "lead" : "leads"}`}>
      <div className="kanban-header"><div><span className={`stage-pin pin-${stage.color}`} /><b>{stage.name}</b><em>{count}</em></div><small>{formatMoneyCompact(total)}</small></div>
      <SortableContext id={stage.id} items={ids} strategy={verticalListSortingStrategy}>
        <div className="kanban-cards" ref={setNodeRef}>
          {ids.map((id) => {
            const lead = leadsById.get(id);
            return lead ? <BoardCard key={id} lead={lead} /> : null;
          })}
          {hidden > 0 && <Link className="kanban-more" to={`/leads?stageId=${stage.id}`}>+{hidden} more · view in list</Link>}
          {ids.length === 0 && <div className="empty-column"><span>{stage.kind === "lost" ? "Drop here to mark as lost" : stage.kind === "won" ? "Drop here to mark as won" : "Drop leads here"}</span></div>}
          {stage.kind !== "lost" && <button className="add-card" onClick={onAdd}><Icon name="plus" size={15} /> Add lead</button>}
        </div>
      </SortableContext>
    </section>
  );
}

export default function Pipeline() {
  const navigate = useNavigate();
  const { openAddLead } = useAppActions();
  const lookups = useLookups();
  const [ownerId, setOwnerId] = useState<string[]>([]);
  const [sourceId, setSourceId] = useState<string[]>([]);
  const [closedWithinDays, setClosedWithinDays] = useState("90");
  const board = usePipeline({ ownerId, sourceId, closedWithinDays: Number(closedWithinDays) });
  const move = useBoardMove();

  const stages = board.data?.columns.map((c) => c.stage) ?? [];
  const leadsById = useMemo(() => new Map((board.data?.columns ?? []).flatMap((c) => c.leads.map((l) => [l.id, l] as const))), [board.data]);
  const serverColumns = useMemo<Columns>(() => Object.fromEntries((board.data?.columns ?? []).map((c) => [c.stage.id, c.leads.map((l) => l.id)])), [board.data]);

  // Local copy so cards move instantly while dragging; resynced from the server when idle.
  const [columns, setColumns] = useState<Columns>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingLost, setPendingLost] = useState<{ id: string; stageId: string; position: number } | null>(null);
  const snapshot = useRef<Columns | null>(null);
  const busy = activeId !== null || pendingLost !== null || move.isPending;
  useEffect(() => { if (!busy) setColumns(serverColumns); }, [serverColumns]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findColumn = (id: string) => (id in columns ? id : Object.keys(columns).find((key) => columns[key]!.includes(id)));
  const stageOf = (stageId: string) => stages.find((s) => s.id === stageId);
  const nameOf = (id: string | number) => leadsById.get(String(id))?.fullName ?? "lead";

  const restore = () => { if (snapshot.current) setColumns(snapshot.current); snapshot.current = null; };

  const onDragStart = ({ active }: DragStartEvent) => {
    snapshot.current = columns;
    setActiveId(String(active.id));
    move.reset();
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = findColumn(String(active.id));
    const to = findColumn(String(over.id));
    if (!from || !to || from === to) return;
    setColumns((prev) => {
      const fromIds = prev[from]!.filter((id) => id !== active.id);
      const toIds = [...prev[to]!];
      const overIndex = toIds.indexOf(String(over.id));
      toIds.splice(overIndex >= 0 ? overIndex : toIds.length, 0, String(active.id));
      return { ...prev, [from]: fromIds, [to]: toIds };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    const id = String(active.id);
    const column = findColumn(id);
    if (!over || !column) return restore();

    let next = columns;
    const overColumn = findColumn(String(over.id));
    if (overColumn === column) {
      const oldIndex = columns[column]!.indexOf(id);
      const newIndex = columns[column]!.indexOf(String(over.id));
      if (newIndex >= 0 && oldIndex !== newIndex) next = { ...columns, [column]: arrayMove(columns[column]!, oldIndex, newIndex) };
    }
    setColumns(next);

    const original = snapshot.current;
    const fromStage = original ? Object.keys(original).find((k) => original[k]!.includes(id)) : undefined;
    const position = next[column]!.indexOf(id);
    if (fromStage === column && original?.[column]!.indexOf(id) === position) { snapshot.current = null; return; }

    const target = stageOf(column);
    if (target?.kind === "lost" && fromStage !== column) {
      setPendingLost({ id, stageId: column, position });
      return;
    }
    move.mutate({ id, stageId: column, position }, { onError: restore, onSuccess: () => { snapshot.current = null; } });
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}. Use the arrow keys to move, Space to drop, Escape to cancel.`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} is over ${stageOf(findColumn(String(over.id)) ?? "")?.name ?? "a column"}.` : `${nameOf(active.id)} is no longer over a column.`),
    onDragEnd: ({ active, over }) => (over ? `${nameOf(active.id)} dropped in ${stageOf(findColumn(String(over.id)) ?? "")?.name ?? "a column"}.` : `${nameOf(active.id)} was dropped.`),
    onDragCancel: ({ active }) => `Moving ${nameOf(active.id)} was cancelled.`,
  };

  const activeLead = activeId ? leadsById.get(activeId) : undefined;

  return <div className="page pipeline-page">
    <div className="page-heading"><div><p className="eyebrow">Sales / Deals by stage</p><h1>Pipeline</h1><p>Drag opportunities between stages as conversations progress.</p></div><Button icon="plus" onClick={() => openAddLead()}>Add lead</Button></div>
    <div className="pipeline-toolbar">
      <div className="view-tabs inline"><button onClick={() => navigate("/leads")}><Icon name="list" size={16}/> List</button><button className="active" aria-current="page"><Icon name="pipeline" size={16}/> Pipeline</button></div>
      <div className="filters">
        <FilterMenu label="All owners" options={lookups.data?.users.map((u) => ({ value: u.id, label: u.name })) ?? []} selected={ownerId} onChange={setOwnerId}/>
        <FilterMenu label="All sources" options={lookups.data?.sources.map((s) => ({ value: s.id, label: s.name })) ?? []} selected={sourceId} onChange={setSourceId}/>
        <FilterMenu label="Closed deals" single options={CLOSED_WINDOWS} selected={[closedWithinDays]} onChange={(v) => setClosedWithinDays(v[0] ?? "90")}/>
      </div>
    </div>
    {board.isError && <FormAlert>{errorMessage(board.error)}</FormAlert>}
    {move.isError && !pendingLost && <FormAlert>Couldn't move the lead: {errorMessage(move.error)} It's back where it was.</FormAlert>}

    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}
      onDragCancel={() => { setActiveId(null); restore(); }} accessibility={{ announcements }}>
      <div className={`kanban ${board.isFetching && !busy ? "refreshing" : ""}`}>
        {board.isPending && Array.from({ length: 5 }, (_, i) => <section className="kanban-column" key={i}><div className="kanban-skeleton"/></section>)}
        {board.data?.columns.map((column) => <Column key={column.stage.id} column={column} ids={columns[column.stage.id] ?? []} leadsById={leadsById} onAdd={() => openAddLead(column.stage.id)}/>)}
      </div>
      <DragOverlay>{activeLead ? <div className={`kanban-card border-${activeLead.temperature} drag-overlay`}><CardBody lead={activeLead} linkName={false}/></div> : null}</DragOverlay>
    </DndContext>

    {pendingLost && <LostDialog leadName={nameOf(pendingLost.id)} pending={move.isPending} error={move.error}
      onClose={() => { setPendingLost(null); restore(); move.reset(); }}
      onConfirm={(reason, notes) => move.mutate({ ...pendingLost, lostReason: reason, lostNotes: notes }, {
        onSuccess: () => { setPendingLost(null); snapshot.current = null; },
      })}/>}
  </div>;
}
