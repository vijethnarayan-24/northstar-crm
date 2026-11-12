import { useEffect, useRef, useState } from "react";
import type { Tone } from "@/types";
import Icon from "./Icon";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Counts up from the previously shown number (0 at first) to `to` with an ease-out, ~0.9 s. */
function useCountUp(to: number | undefined, duration = 900) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (to === undefined) return;
    if (reducedMotion()) { setShown(to); from.current = to; return; }
    const start = performance.now(), begin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(begin + (to - begin) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = to;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, duration]);
  return shown;
}

/**
 * KPI card with a large animated counter. `previous` compares with the previous period
 * ("+25% vs previous 30 days"); `change` overrides that text; `note` explains a point-in-time number.
 */
export default function StatCard({ label, count, format = (n) => String(Math.round(n)), icon, tone, previous, periodLabel, note, change: changeOverride }: {
  label: string;
  /** The number to show; undefined while loading. */
  count: number | undefined;
  format?: (n: number) => string;
  icon: string;
  tone: Tone;
  previous?: number | null;
  periodLabel?: string;
  note?: string;
  change?: { text: string; positive: boolean | null } | null;
}) {
  const shown = useCountUp(count);
  let change = changeOverride ?? null;
  if (!change && count !== undefined && previous !== undefined && previous !== null) {
    if (previous === 0) change = count === 0 ? { text: "No change", positive: null } : { text: "New", positive: true };
    else {
      const pct = Math.round(((count - previous) / previous) * 100);
      change = { text: `${pct > 0 ? "+" : ""}${pct}%`, positive: pct === 0 ? null : pct > 0 };
    }
  }
  return <div className="card stat-card"><div className={`stat-icon stat-${tone}`}><Icon name={icon}/></div><div className="stat-main"><span>{label}</span>
    <strong aria-hidden="true">{count === undefined ? "–" : format(shown)}</strong>
    <span className="sr-only">{count === undefined ? "Loading" : format(count)}</span>
    {change
      ? <small className={change.positive === true ? "positive" : change.positive === false ? "negative" : ""}>{change.text} <em>vs previous {periodLabel}</em></small>
      : <small><em>{note}</em></small>}
  </div></div>;
}
