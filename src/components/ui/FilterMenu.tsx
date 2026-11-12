import { useEffect, useId, useRef, useState } from "react";

export interface FilterOption { value: string; label: string }

/**
 * Toolbar filter: a button showing the label (and how many are selected) that opens
 * a checkbox list. `single` turns it into a radio list.
 */
export default function FilterMenu({ label, options, selected, onChange, single = false }: { label: string; options: FilterOption[]; selected: string[]; onChange: (values: string[]) => void; single?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    root.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const active = selected.length > 0;
  const summary = !active ? label : single ? options.find((o) => o.value === selected[0])?.label ?? label : `${label} · ${selected.length}`;
  const toggle = (value: string) => {
    if (single) { onChange(selected[0] === value ? [] : [value]); setOpen(false); return; }
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <div className="menu filter-menu" ref={root}>
      <button ref={button} type="button" className={`filter-btn ${active ? "active" : ""}`} aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((o) => !o)}>
        {summary}<span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="menu-list menu-left filter-panel" id={panelId} role="group" aria-label={`Filter by ${label}`}>
          {options.length === 0 && <p className="empty-note">Nothing to filter by yet.</p>}
          {options.map((o) => (
            <label key={o.value} className="filter-option">
              <input type={single ? "radio" : "checkbox"} name={single ? panelId : undefined} checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
          {active && <button type="button" className="filter-clear" onClick={() => { onChange([]); setOpen(false); }}>Clear</button>}
        </div>
      )}
    </div>
  );
}
