import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { errorMessage } from "@/lib/api";
import { useMe } from "./useAuth";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isPending, isError, error, refetch } = useMe();
  const location = useLocation();

  if (isPending) return <div className="splash" role="status" aria-live="polite"><span className="brand-mark">N</span>Loading…</div>;
  // A failed background refresh (server restarting, network blip) keeps the signed-in app on screen;
  // only a failure with no known user blocks the page. A real sign-out arrives as `null`, not an error.
  if (isError && user === undefined)
    return (
      <div className="splash" role="alert">
        <span className="brand-mark">N</span>
        <p>{errorMessage(error)}</p>
        <button className="btn btn-secondary" onClick={() => refetch()}>Try again</button>
      </div>
    );
  if (!user) {
    const next = location.pathname + location.search;
    return <Navigate to={next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}
