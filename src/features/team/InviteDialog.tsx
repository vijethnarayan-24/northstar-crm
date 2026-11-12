import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { inviteInput, type InviteCreatedDTO } from "@crm/shared";
import { z } from "zod";
import FormAlert from "@/components/form/FormAlert";
import TextField from "@/components/form/TextField";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { errorMessage } from "@/lib/api";
import { applyServerErrors } from "@/lib/forms";
import { useInvite } from "./useTeam";

type FormValues = z.input<typeof inviteInput>;

/** Shows a just-created invite link with a copy button. */
export function InviteLink({ result }: { result: InviteCreatedDTO }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="invite-result">
      <FormAlert tone="success">Invite created for <b>{result.invitation.email}</b>. The link works for 7 days.</FormAlert>
      <label className="field" htmlFor="invite-url">Invite link</label>
      <div className="copy-row">
        <input id="invite-url" readOnly value={result.inviteUrl} onFocus={(e) => e.currentTarget.select()} />
        <Button variant="secondary" onClick={copy}>{copied ? "Copied" : "Copy link"}</Button>
      </div>
      <p className="muted-note">Email delivery isn't set up yet, so send this link to them yourself.</p>
    </div>
  );
}

export default function InviteDialog({ onClose }: { onClose: () => void }) {
  const invite = useInvite();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(inviteInput), defaultValues: { role: "member" } });

  if (invite.data)
    return (
      <Dialog title="Invite sent" onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
        <InviteLink result={invite.data} />
      </Dialog>
    );

  const onSubmit = handleSubmit((values) => invite.mutate({ email: values.email, role: values.role ?? "member" }, { onError: (e) => applyServerErrors(e, setError) }));

  return (
    <Dialog
      title="Invite a teammate"
      description="They'll get a link to create their account."
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><button className="btn btn-primary" type="submit" form="invite-form" disabled={invite.isPending}>{invite.isPending ? "Inviting…" : "Send invite"}</button></>}
    >
      <form id="invite-form" className="dialog-form" onSubmit={onSubmit} noValidate>
        {invite.isError && <FormAlert>{errorMessage(invite.error)}</FormAlert>}
        <TextField label="Email" type="email" autoFocus placeholder="name@company.com" error={errors.email?.message} {...register("email")} />
        <div className="field">
          <label htmlFor="invite-role">Role</label>
          <select id="invite-role" {...register("role")}>
            <option value="member">Member – works leads, tasks and pipeline</option>
            <option value="admin">Admin – also manages team and settings</option>
          </select>
        </div>
      </form>
    </Dialog>
  );
}
