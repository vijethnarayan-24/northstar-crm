import type { ReactNode } from "react";
import Icon from "./Icon";

/**
 * Pill button. While an action runs, pass `loading` (or, by convention, a disabled button
 * whose label ends in "…", like "Saving…"): it shows a spinner and tells screen readers it's busy.
 */
export default function Button({ children, variant = "primary", icon, onClick, className = "", disabled = false, loading, type = "button" }: { children?: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger"; icon?: string; onClick?: () => void; className?: string; disabled?: boolean; loading?: boolean; type?: "button" | "submit" }) {
  const busy = loading ?? (disabled && typeof children === "string" && children.endsWith("…"));
  return (
    <button type={type} className={`btn btn-${variant} ${busy ? "is-loading" : ""} ${className}`} onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? <span className="spinner" aria-hidden="true"/> : icon && <Icon name={icon} size={16}/>} {children}
    </button>
  );
}
