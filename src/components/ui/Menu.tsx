import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Small dropdown menu: closes on outside click, Escape, or selection; arrow keys move focus. */
export default function Menu({ label, trigger, items, align = "right", className = "" }: { label: string; trigger: ReactNode; items: MenuItem[]; align?: "left" | "right"; className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); button.current?.focus(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const nodes = [...(root.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
        const i = nodes.indexOf(document.activeElement as HTMLButtonElement);
        nodes[(i + (e.key === "ArrowDown" ? 1 : -1) + nodes.length) % nodes.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    root.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className={`menu ${className}`} ref={root}>
      <button ref={button} type="button" className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div className={`menu-list menu-${align}`} role="menu" id={menuId}>
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" disabled={item.disabled} className={item.danger ? "danger" : ""} onClick={() => { setOpen(false); item.onSelect(); }}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
