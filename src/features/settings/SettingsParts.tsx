import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState, type ReactNode } from "react";
import { COLORS, type Color } from "@crm/shared";
import FormAlert from "@/components/form/FormAlert";
import TextField from "@/components/form/TextField";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { ApiError, errorMessage } from "@/lib/api";

export function ColorPicker({ value, onChange, label = "Color" }: { value: Color; onChange: (c: Color) => void; label?: string }) {
  return (
    <fieldset className="choice-group">
      <legend>{label}</legend>
      <div className="swatches">
        {COLORS.map((c) => (
          <button key={c} type="button" className={`swatch swatch-dot bg-${c} ${value === c ? "selected" : ""}`} aria-label={c} aria-pressed={value === c} onClick={() => onChange(c)} />
        ))}
      </div>
    </fieldset>
  );
}

/** Add / edit dialog for anything with a name and a color (sources, stages, tags). */
export function NameColorDialog({ title, description, initial, saveLabel, onSave, onClose, pending, error }: {
  title: string; description?: string; initial?: { name: string; color: Color }; saveLabel: string;
  onSave: (v: { name: string; color: Color }) => void; onClose: () => void; pending: boolean; error: unknown;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState<Color>(initial?.color ?? "violet");
  const [touched, setTouched] = useState(false);
  const nameError = touched && !name.trim() ? "Name is required" : error instanceof ApiError ? error.issues.name?.[0] : undefined;
  const otherError = error && !(error instanceof ApiError && error.issues.name) ? errorMessage(error) : null;
  const submit = () => { setTouched(true); if (name.trim()) onSave({ name: name.trim(), color }); };

  return (
    <Dialog title={title} description={description} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={pending} onClick={submit}>{pending ? "Saving…" : saveLabel}</Button></>}>
      <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        {otherError && <FormAlert>{otherError}</FormAlert>}
        <TextField label="Name" value={name} maxLength={60} error={nameError} onChange={(e) => setName(e.target.value)} />
        <ColorPicker value={color} onChange={setColor} />
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({ title, description, confirmLabel, danger = true, onConfirm, onClose, pending, error, children }: {
  title: string; description?: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void; pending: boolean; error: unknown; children?: ReactNode;
}) {
  return (
    <Dialog title={title} description={description} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={danger ? "danger" : "primary"} disabled={pending} onClick={onConfirm}>{pending ? "Working…" : confirmLabel}</Button></>}>
      <div className="dialog-form">{error ? <FormAlert>{errorMessage(error)}</FormAlert> : null}{children ?? <span />}</div>
    </Dialog>
  );
}

function SortableRow({ id, label, disabled, children }: { id: string; label: string; disabled: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div ref={setNodeRef} className={`setting-row ${isDragging ? "is-dragging" : ""}`} style={{ transform: CSS.Translate.toString(transform), transition }}>
      {disabled ? <span className="drag-handle-spacer" /> : (
        <button type="button" className="drag-handle" ref={setActivatorNodeRef} aria-label={`Reorder ${label}`} {...attributes} {...listeners}>⋮⋮</button>
      )}
      {children}
    </div>
  );
}

/** Rows that admins can reorder by dragging the handle (or Space + arrow keys). */
export function SortableRows<T extends { id: string; name: string }>({ items, canReorder, onReorder, render }: {
  items: T[]; canReorder: boolean; onReorder: (ids: string[]) => void; render: (item: T) => ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = items.map((i) => i.id);
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        {items.map((item) => <SortableRow key={item.id} id={item.id} label={item.name} disabled={!canReorder}>{render(item)}</SortableRow>)}
      </SortableContext>
    </DndContext>
  );
}

export const countLabel = (n: number) => `${n} ${n === 1 ? "lead" : "leads"}`;
