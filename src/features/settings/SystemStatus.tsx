import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AppErrorDTO, SystemStatusDTO } from "@crm/shared";
import FormAlert from "@/components/form/FormAlert";
import Button from "@/components/ui/Button";
import { SkeletonList } from "@/components/ui/Skeleton";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, relativeTime } from "@/lib/format";

const useStatus = () => useQuery({ queryKey: ["system", "status"], queryFn: () => api.get<SystemStatusDTO>("/system/status"), refetchInterval: 60_000 });
const useErrors = (status: "open" | "resolved") =>
  useQuery({ queryKey: ["system", "errors", status], queryFn: async () => (await api.get<{ errors: AppErrorDTO[] }>(`/system/errors?status=${status}`)).errors, refetchInterval: 60_000 });

function useResolve() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: (_d, id) => (id ? "Marked as resolved" : "All errors marked as resolved"), errorToast: true },
    mutationFn: (id?: string) => api.post(id ? `/system/errors/${id}/resolve` : "/system/errors/resolve-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["system"] }),
  });
}

function Tile({ label, value, note, state }: { label: string; value: string; note: string; state: "ok" | "warn" | "bad" }) {
  return <div className="status-tile"><span><i className={`status-dot status-${state}`}/>{label}</span><b>{value}</b><small>{note}</small></div>;
}

/**
 * Admin-only health page: database, background jobs, storage and every recorded error.
 * Errors are grouped (a repeat counts up); new ones also notify admins through the bell.
 */
export default function SystemStatus() {
  const [view, setView] = useState<"open" | "resolved">("open");
  const status = useStatus();
  const errors = useErrors(view);
  const resolve = useResolve();
  const s = status.data;

  return (
    <>
      <section className="card settings-card">
        <div className="card-header"><div><h2>{!s ? "Checking…" : s.overall === "ok" ? "All systems normal" : "Needs attention"}</h2><p>System / {s ? `checked ${relativeTime(s.checkedAt).toLowerCase()}` : "loading"}</p></div>
          <button type="button" className="text-button" onClick={() => { void status.refetch(); void errors.refetch(); }}>Check again</button></div>
        {status.isError && <div className="settings-alert"><FormAlert>{errorMessage(status.error)}</FormAlert></div>}
        {!s && status.isPending && <SkeletonList rows={2} avatar={false}/>}
        {s && <div className="status-grid">
          <Tile label="Database" state={s.database.ok ? "ok" : "bad"} value={s.database.ok ? "Online" : "Down"} note={s.database.latencyMs === null ? "Not reachable" : `Answered in ${s.database.latencyMs} ms`}/>
          <Tile label="Reminders" state={s.jobs.ok ? "ok" : "warn"} value={s.jobs.lastRunAt ? relativeTime(s.jobs.lastRunAt) : "Never run"} note={s.jobs.ok ? "Follow-up and task reminders are running" : "Haven't run in the last day"}/>
          <Tile label="Open errors" state={s.errors.open ? "bad" : "ok"} value={String(s.errors.open)} note={`${s.errors.last24h} seen in the last 24 hours`}/>
          <Tile label="Email" state={s.email.configured ? "ok" : "warn"} value={s.email.configured ? "Connected" : "Not set up"} note={s.email.configured ? "Invites and resets are emailed" : "Invites and password resets aren't emailed yet"}/>
        </div>}
        {s && <p className="report-note">
          Running in <b>{s.deployment.environment}</b>{s.deployment.region ? <> · region <b>{s.deployment.region}</b></> : null}{s.deployment.commit ? <> · version <b>{s.deployment.commit}</b></> : null} · files stored on {s.storage === "blob" ? "Vercel Blob (private)" : "the server's disk"} · this server started {relativeTime(s.deployment.startedAt).toLowerCase()}.
        </p>}
      </section>

      <section className="card settings-card">
        <div className="card-header">
          <div><h2>Errors</h2><p>Recorded automatically / server and browser</p></div>
          <div className="view-tabs inline" role="group" aria-label="Which errors">
            <button className={view === "open" ? "active" : ""} aria-pressed={view === "open"} onClick={() => setView("open")}>Open</button>
            <button className={view === "resolved" ? "active" : ""} aria-pressed={view === "resolved"} onClick={() => setView("resolved")}>Resolved</button>
          </div>
        </div>
        {errors.isError && <div className="settings-alert"><FormAlert>{errorMessage(errors.error)}</FormAlert></div>}
        {errors.isPending && <SkeletonList rows={3} avatar={false}/>}
        {errors.data?.length === 0 && <p className="empty-note list-note">{view === "open" ? "No open errors. Everything is running smoothly." : "Nothing resolved yet."}</p>}
        <ul className="error-list">{errors.data?.map((e) => (
          <li key={e.id}>
            <b>{e.message}</b>
            <span className="count" title="Times seen">{e.count}×</span>
            <small>
              {e.source === "server" ? "Server" : "Browser"}{e.status ? ` · ${e.status}` : ""}{e.method && e.source === "server" ? ` · ${e.method}` : ""}{e.path ? ` ${e.path}` : ""}
              {" · last "}{formatDateTime(e.lastSeenAt)}{e.count > 1 ? ` · first ${formatDateTime(e.firstSeenAt)}` : ""}{e.user ? ` · ${e.user.name}` : ""}
            </small>
            {e.stack && <details><summary>Technical details</summary><pre>{e.stack}</pre></details>}
            {view === "open" && <div className="error-actions"><Button variant="secondary" disabled={resolve.isPending} onClick={() => resolve.mutate(e.id)}>Mark resolved</Button></div>}
          </li>
        ))}</ul>
        {view === "open" && (errors.data?.length ?? 0) > 1 && <div className="feed-more"><Button variant="secondary" disabled={resolve.isPending} onClick={() => resolve.mutate(undefined)}>Mark all resolved</Button></div>}
        <p className="report-note">Admins get a bell notification when a new error appears (and again at most hourly while it repeats). A resolved error that happens again reopens and alerts again.</p>
      </section>
    </>
  );
}
