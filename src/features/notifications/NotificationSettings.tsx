import { useCurrentUser } from "@/auth/useAuth";
import { NOTIFICATION_CATEGORIES } from "@crm/shared";
import FormAlert from "@/components/form/FormAlert";
import { errorMessage } from "@/lib/api";
import { useNotificationPrefs, useSetNotificationPref } from "./useNotifications";

/** Per-category in-app notification switches. Email delivery comes later. */
export default function NotificationSettings() {
  const isAdmin = useCurrentUser().role === "admin";
  const prefs = useNotificationPrefs();
  const set = useSetNotificationPref();
  return (
    <section className="card settings-card">
      <div className="card-header"><div><h2>Notifications</h2><p>Choose what shows up under the bell. Email notifications will be added later.</p></div></div>
      <div className="settings-body">
        {(prefs.error || set.error) && <FormAlert>{errorMessage(prefs.error ?? set.error)}</FormAlert>}
        <table className="pref-table">
          <thead><tr><th>Notify me when…</th><th>In app</th><th>Email</th></tr></thead>
          <tbody>
            {NOTIFICATION_CATEGORIES.filter((c) => !("adminOnly" in c && c.adminOnly) || isAdmin).map((c) => {
              const on = prefs.data?.categories.find((p) => p.key === c.key)?.inApp ?? true;
              return (
                <tr key={c.key}>
                  <td><b>{c.label}</b><small>{c.description}</small></td>
                  <td><label className="switch"><input type="checkbox" role="switch" checked={on} disabled={!prefs.data || set.isPending} aria-label={`${c.label} in app`} onChange={(e) => set.mutate({ key: c.key, inApp: e.target.checked })} /><span /></label></td>
                  <td><small className="muted">Coming later</small></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
