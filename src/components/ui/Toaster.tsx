import { useEffect, useRef, useSyncExternalStore } from "react";
import Icon from "@/components/ui/Icon";

/**
 * Short status messages ("Lead saved", "Couldn't reach the server") that appear in a corner
 * and fade away. Call `toast.success(...)` / `toast.error(...)` / `toast.info(...)` from
 * anywhere; <Toaster/> (mounted once in main.tsx) shows them.
 */
export type ToastTone = "success" | "error" | "info";
export interface Toast { id: number; tone: ToastTone; message: string; detail?: string }

const DURATION: Record<ToastTone, number> = { success: 3500, info: 4500, error: 7000 };
const MAX_VISIBLE = 4;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(tone: ToastTone, message: string, detail?: string) {
  // The same message twice in a row (e.g. a double click) shows once.
  const last = toasts.at(-1);
  if (last && last.message === message && last.tone === tone) return last.id;
  const item = { id: nextId++, tone, message, detail };
  toasts = [...toasts, item].slice(-MAX_VISIBLE);
  emit();
  return item.id;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (message: string, detail?: string) => push("success", message, detail),
  error: (message: string, detail?: string) => push("error", message, detail),
  info: (message: string, detail?: string) => push("info", message, detail),
};

const ICON: Record<ToastTone, string> = { success: "check", error: "x", info: "bell" };

function ToastItem({ t }: { t: Toast }) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = () => { timer.current = setTimeout(() => dismissToast(t.id), DURATION[t.tone]); };
  const stop = () => clearTimeout(timer.current);
  useEffect(() => { start(); return stop; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`toast toast-${t.tone}`} role={t.tone === "error" ? "alert" : "status"} onMouseEnter={stop} onMouseLeave={start} onFocus={stop} onBlur={start}>
      <span className="toast-icon" aria-hidden="true"><Icon name={ICON[t.tone]} size={14}/></span>
      <div className="toast-text"><b>{t.message}</b>{t.detail && <small>{t.detail}</small>}</div>
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}><Icon name="x" size={14}/></button>
    </div>
  );
}

export default function Toaster() {
  const items = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => toasts, () => toasts);
  return <div className="toaster" aria-live="polite">{items.map((t) => <ToastItem key={t.id} t={t}/>)}</div>;
}
