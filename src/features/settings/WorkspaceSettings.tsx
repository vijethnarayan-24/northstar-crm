import { useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "@/auth/useAuth";
import FormAlert from "@/components/form/FormAlert";
import TextField from "@/components/form/TextField";
import Button from "@/components/ui/Button";
import { ApiError, errorMessage } from "@/lib/api";
import { useUpdateWorkspace, useWorkspace } from "./useSettings";

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * All IANA zones the browser knows, with the current UTC offset for readability. The computer's
 * own zone and the saved zone are always included: some systems report legacy aliases
 * (e.g. "Asia/Calcutta") that the canonical list spells differently ("Asia/Kolkata").
 */
function useTimeZones(saved: string | undefined) {
  return useMemo(() => {
    // ES2022 API; available in all current browsers but not in this project's ES2020 type lib.
    const supported = (Intl as unknown as { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf;
    const zones = supported ? supported("timeZone") : [browserZone, "UTC"];
    const offset = (tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
    const all = [...new Set(["UTC", ...zones, browserZone, ...(saved ? [saved] : [])])].sort((a, b) => (a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b)));
    return all.map((tz) => ({ tz, label: `${tz.replace(/_/g, " ")} (${offset(tz).replace("GMT", "UTC")})` }));
  }, [saved]);
}

export default function WorkspaceSettings() {
  const isAdmin = useCurrentUser().role === "admin";
  const workspace = useWorkspace();
  const update = useUpdateWorkspace();
  const zones = useTimeZones(workspace.data?.timezone);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  useEffect(() => { if (workspace.data) { setName(workspace.data.name); setTimezone(workspace.data.timezone); } }, [workspace.data]);

  const dirty = !!workspace.data && (name !== workspace.data.name || timezone !== workspace.data.timezone);
  const issues = update.error instanceof ApiError ? update.error.issues : {};

  return (
    <section className="card settings-card">
      <div className="card-header"><div><h2>Workspace</h2><p>Your company name and the time zone used for "today", due dates and reports.</p></div></div>
      <form className="settings-body settings-form" noValidate onSubmit={(e) => { e.preventDefault(); update.mutate({ name, timezone }); }}>
        {workspace.error && <FormAlert>{errorMessage(workspace.error)}</FormAlert>}
        {update.isSuccess && !dirty && <FormAlert tone="success">Workspace settings saved.</FormAlert>}
        {update.isError && !Object.keys(issues).length && <FormAlert>{errorMessage(update.error)}</FormAlert>}
        {workspace.data && workspace.data.timezone !== browserZone && timezone !== browserZone && isAdmin && (
          <FormAlert tone="info">Your computer is set to <b>{browserZone}</b>. <button type="button" className="inline-link" onClick={() => setTimezone(browserZone)}>Use that time zone</button></FormAlert>
        )}
        <TextField label="Workspace name" value={name} disabled={!isAdmin} error={issues.name?.[0]} onChange={(e) => setName(e.target.value)} />
        <div className={`field ${issues.timezone ? "has-error" : ""}`}>
          <label htmlFor="ws-timezone">Time zone</label>
          <select id="ws-timezone" value={timezone} disabled={!isAdmin} onChange={(e) => setTimezone(e.target.value)}>
            {zones.map((z) => <option key={z.tz} value={z.tz}>{z.label}</option>)}
          </select>
          {issues.timezone && <small className="field-error">{issues.timezone[0]}</small>}
        </div>
        <TextField label="Currency" value={workspace.data?.currency ?? "USD"} disabled hint="All deal values are in this currency." />
        {isAdmin ? <div><Button type="submit" disabled={!dirty || update.isPending}>{update.isPending ? "Saving…" : "Save changes"}</Button></div>
          : <p className="muted-note">Only workspace admins can change these settings.</p>}
      </form>
    </section>
  );
}
