import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { SearchResultsDTO } from "@crm/shared";
import Badge from "@/components/ui/Badge";
import Icon from "@/components/ui/Icon";
import { api, errorMessage } from "@/lib/api";
import { formatFollowup } from "@/lib/format";

interface Item { key: string; group: string; title: string; detail?: string; badge?: { tone: Parameters<typeof Badge>[0]["tone"]; label: string }; to: string; icon: string }

const QUICK_LINKS: Item[] = [
  { key: "go-leads", group: "Go to", title: "Leads", to: "/leads", icon: "users" },
  { key: "go-pipeline", group: "Go to", title: "Pipeline", to: "/pipeline", icon: "pipeline" },
  { key: "go-tasks", group: "Go to", title: "My tasks", to: "/tasks", icon: "check" },
  { key: "go-activity", group: "Go to", title: "Activity", to: "/activity", icon: "clock" },
  { key: "go-settings", group: "Go to", title: "Settings", to: "/settings", icon: "settings" },
];

/** ⌘K / Ctrl+K search across leads, tasks and documents, plus quick navigation. */
export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  useEffect(() => { const t = setTimeout(() => setTerm(text.trim()), 150); return () => clearTimeout(t); }, [text]);

  const search = useQuery({
    queryKey: ["search", term],
    queryFn: () => api.get<SearchResultsDTO>(`/search?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
    staleTime: 10_000,
  });

  const items = useMemo<Item[]>(() => {
    if (term.length < 2) return QUICK_LINKS;
    const r = search.data;
    if (!r) return [];
    return [
      ...r.leads.map((l) => ({ key: `l-${l.id}`, group: "Leads", title: l.fullName, detail: [l.company, l.email].filter(Boolean).join(" · "), badge: { tone: l.stage.color, label: l.stage.name }, to: `/leads/${l.id}`, icon: "users" })),
      ...r.tasks.map((t) => ({ key: `t-${t.id}`, group: "Tasks", title: t.title, detail: [t.lead?.fullName, t.completedAt ? "Done" : t.dueAt ? formatFollowup(t.dueAt).label : null].filter(Boolean).join(" · "), to: t.lead ? `/leads/${t.lead.id}?tab=tasks` : "/tasks?view=upcoming", icon: "check" })),
      ...r.documents.map((d) => ({ key: `d-${d.id}`, group: "Documents", title: d.filename, detail: d.lead.fullName, to: `/leads/${d.lead.id}?tab=documents`, icon: "file" })),
    ];
  }, [term, search.data]);
  useEffect(() => setActive(0), [items]);

  const go = (item: Item) => { onClose(); navigate(item.to); };
  let lastGroup = "";

  return (
    <dialog ref={dialog} className="dialog palette" aria-label="Search" onCancel={(e) => { e.preventDefault(); onClose(); }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette-input">
        <Icon name="search" size={17} />
        <input
          autoFocus
          aria-label="Search leads, tasks and documents"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items[active] ? `${listId}-${items[active]!.key}` : undefined}
          placeholder="Search leads, companies, emails, tasks, documents…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            if (e.key === "Enter" && items[active]) { e.preventDefault(); go(items[active]!); }
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <ul className="palette-list" role="listbox" id={listId}>
        {term.length >= 2 && search.isPending && <li className="palette-note">Searching…</li>}
        {search.isError && <li className="palette-note">{errorMessage(search.error)}</li>}
        {term.length >= 2 && search.data && items.length === 0 && <li className="palette-note">No results for “{term}”</li>}
        {items.map((item, i) => {
          const header = item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          return [
            header && <li key={`h-${header}`} className="palette-group" role="presentation">{header}</li>,
            <li key={item.key} id={`${listId}-${item.key}`} role="option" aria-selected={i === active} className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); go(item); }}>
              <Icon name={item.icon} size={15} />
              <span className="palette-title"><b>{item.title}</b>{item.detail && <small>{item.detail}</small>}</span>
              {item.badge && <Badge tone={item.badge.tone}>{item.badge.label}</Badge>}
            </li>,
          ];
        })}
      </ul>
      <div className="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span></div>
    </dialog>
  );
}
