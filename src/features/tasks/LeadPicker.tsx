import { useEffect, useId, useState } from "react";
import { useLeadList } from "@/features/leads/useLeads";

/** ownerId decides who may assign the task to someone else (see canAssignTask on the server). */
export interface PickedLead { id: string; fullName: string; company: string | null; ownerId?: string | null }

/** Search-as-you-type lead selector (combobox). */
export default function LeadPicker({ value, onChange, label = "Lead (optional)", error }: { value: PickedLead | null; onChange: (lead: PickedLead | null) => void; label?: string; error?: string }) {
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  useEffect(() => { const t = setTimeout(() => setTerm(text.trim()), 200); return () => clearTimeout(t); }, [text]);
  const results = useLeadList({ q: term || undefined, pageSize: 8, sort: "lastActivityAt", dir: "desc" }, { enabled: open });
  const items = results.data?.items ?? [];

  if (value) return (
    <div className="field wide">
      <span className="field-label">{label}</span>
      <div className="picked-lead"><b>{value.fullName}</b>{value.company && <small>{value.company}</small>}<button type="button" className="text-button" onClick={() => onChange(null)}>Change</button></div>
    </div>
  );

  const choose = (lead: (typeof items)[number]) => { onChange({ id: lead.id, fullName: lead.fullName, company: lead.company, ownerId: lead.owner?.id ?? null }); setText(""); setOpen(false); };

  return (
    <div className={`field wide lead-picker ${error ? "has-error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${id}-${items[active]!.id}` : undefined}
        placeholder="Search leads by name or company…"
        value={text}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          if (e.key === "Enter" && open && items[active]) { e.preventDefault(); choose(items[active]!); }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul className="picker-list" role="listbox" id={`${id}-list`}>
          {results.isPending && <li className="picker-empty">Searching…</li>}
          {!results.isPending && items.length === 0 && <li className="picker-empty">No leads found</li>}
          {items.map((l, i) => (
            <li key={l.id} id={`${id}-${l.id}`} role="option" aria-selected={i === active} className={i === active ? "active" : ""} onMouseDown={(e) => { e.preventDefault(); choose(l); }}>
              <b>{l.fullName}</b><small>{l.company ?? ""}</small>
            </li>
          ))}
        </ul>
      )}
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}
