import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { COLORS, changePasswordInput, type Color, type UserStatus } from "@crm/shared";
import { initialsOf, useCurrentUser } from "@/auth/useAuth";
import FormAlert from "@/components/form/FormAlert";
import TextField from "@/components/form/TextField";
import Avatar from "@/components/ui/Avatar";
import { errorMessage } from "@/lib/api";
import { applyServerErrors } from "@/lib/forms";
import { useChangePassword, useUpdateProfile } from "./useTeam";

const profileForm = z.object({ name: z.string().trim().min(1, "Name is required").max(120) });
const passwordForm = changePasswordInput
  .extend({ confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "Passwords don't match" });
type PasswordValues = z.infer<typeof passwordForm>;

export default function ProfileSettings() {
  const me = useCurrentUser();
  const update = useUpdateProfile();
  const change = useChangePassword();

  const profile = useForm<z.infer<typeof profileForm>>({ resolver: zodResolver(profileForm), values: { name: me.name } });
  const password = useForm<PasswordValues>({ resolver: zodResolver(passwordForm) });

  const setColor = (avatarColor: Color) => update.mutate({ avatarColor });
  const setStatus = (status: UserStatus) => update.mutate({ status });

  return (
    <>
      <section className="card settings-card">
        <div className="card-header"><div><h2>Profile</h2><p>How you appear to your team.</p></div></div>
        <div className="settings-body">
          {update.isError && <FormAlert>{errorMessage(update.error)}</FormAlert>}
          <div className="profile-head">
            <Avatar initials={initialsOf(me.name)} color={me.avatarColor} size="lg" />
            <div><b>{me.name}</b><small>{me.email} · {me.role === "admin" ? "Workspace admin" : "Member"}</small></div>
          </div>
          <form className="settings-form" onSubmit={profile.handleSubmit((v) => update.mutate(v, { onError: (e) => applyServerErrors(e, profile.setError) }))} noValidate>
            <TextField label="Full name" autoComplete="name" error={profile.formState.errors.name?.message} {...profile.register("name")} />
            <div><button className="btn btn-primary" type="submit" disabled={update.isPending || !profile.formState.isDirty}>Save name</button></div>
          </form>
          <fieldset className="choice-group">
            <legend>Avatar color</legend>
            <div className="swatches">
              {COLORS.map((c) => (
                <button key={c} type="button" className={`swatch avatar-${c} ${me.avatarColor === c ? "selected" : ""}`} aria-label={c} aria-pressed={me.avatarColor === c} onClick={() => setColor(c)} />
              ))}
            </div>
          </fieldset>
          <fieldset className="choice-group">
            <legend>Status</legend>
            <div className="pill-selector">
              {(["active", "away"] as const).map((s) => (
                <button key={s} type="button" className={me.status === s ? "active" : ""} aria-pressed={me.status === s} onClick={() => setStatus(s)}>{s === "active" ? "Active" : "Away"}</button>
              ))}
            </div>
          </fieldset>
        </div>
      </section>

      <section className="card settings-card">
        <div className="card-header"><div><h2>Password</h2><p>Changing it signs you out on your other devices.</p></div></div>
        <form
          className="settings-body settings-form"
          noValidate
          onSubmit={password.handleSubmit(({ currentPassword, newPassword }) =>
            change.mutate({ currentPassword, newPassword }, {
              onSuccess: () => password.reset(),
              onError: (e) => {
                if (!applyServerErrors(e, password.setError)) password.setError("currentPassword", { type: "server", message: errorMessage(e) });
              },
            }),
          )}
        >
          {change.isSuccess && <FormAlert tone="success">Password updated.</FormAlert>}
          <TextField label="Current password" type="password" autoComplete="current-password" error={password.formState.errors.currentPassword?.message} {...password.register("currentPassword")} />
          <TextField label="New password" type="password" autoComplete="new-password" hint="At least 12 characters" error={password.formState.errors.newPassword?.message} {...password.register("newPassword")} />
          <TextField label="Confirm new password" type="password" autoComplete="new-password" error={password.formState.errors.confirm?.message} {...password.register("confirm")} />
          <div><button className="btn btn-primary" type="submit" disabled={change.isPending}>{change.isPending ? "Updating…" : "Update password"}</button></div>
        </form>
      </section>
    </>
  );
}
