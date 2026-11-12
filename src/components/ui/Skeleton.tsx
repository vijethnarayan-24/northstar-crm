import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/** Shimmering placeholder rows shown while a list loads (announced once to screen readers). */
export function SkeletonList({ rows = 4, avatar = true, className = "" }: { rows?: number; avatar?: boolean; className?: string }) {
  return (
    <div className={`skeleton-list ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-item" key={i} aria-hidden="true">
          {avatar && <span className="sk sk-circle"/>}
          <span className="sk-lines"><span className="sk sk-line" style={{ width: `${70 - (i % 3) * 12}%` }}/><span className="sk sk-line short"/></span>
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a whole page while its code loads. */
export function PageSkeleton() {
  return (
    <div className="page" role="status" aria-label="Loading page">
      <div className="page-skeleton" aria-hidden="true">
        <span className="sk sk-line" style={{ width: 140, height: 10 }}/>
        <span className="sk sk-title"/>
        <span className="sk sk-line" style={{ width: "45%" }}/>
        <div className="sk-cards">{Array.from({ length: 4 }, (_, i) => <span className="sk sk-card" key={i}/>)}</div>
        <span className="sk sk-panel"/>
      </div>
    </div>
  );
}

/**
 * Thin bar along the top of the window while anything is loading or saving. It waits 250 ms
 * before appearing, so quick requests don't flash it.
 */
export function TopProgress() {
  const busy = useIsFetching() + useIsMutating() > 0;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!busy) { setVisible(false); return; }
    const t = setTimeout(() => setVisible(true), 250);
    return () => clearTimeout(t);
  }, [busy]);
  return <div className={`top-progress ${visible ? "active" : ""}`} aria-hidden="true"><i/></div>;
}
