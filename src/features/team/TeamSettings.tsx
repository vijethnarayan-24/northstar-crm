import { useState } from "react";
import type { InviteCreatedDTO, UserDTO } from "@crm/shared";
import { initialsOf, useCurrentUser } from "@/auth/useAuth";
import FormAlert from "@/components/form/FormAlert";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import Icon from "@/components/ui/Icon";
import Menu, { type MenuItem } from "@/components/ui/Menu";
import { errorMessage } from "@/lib/api";
import InviteDialog, { InviteLink } from "./InviteDialog";
import { useInvitations, useRenewInvite, useRevokeInvite, useUpdateMember, useUsers } from "./useTeam";
import { useResetLink } from "@/features/settings/useSettings";
import type { ResetLinkDTO } from "@crm/shared";

const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

export default function TeamSettings() {
  const me = useCurrentUser();
  const isAdmin = me.role === "admin";
  const users = useUsers();
  const invites = useInvitations(isAdmin);
  const updateMember = useUpdateMember();
  const renew = useRenewInvite();
  const revoke = useRevokeInvite();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [renewed, setRenewed] = useState<InviteCreatedDTO | null>(null);
  const [confirm, setConfirm] = useState<UserDTO | null>(null);
  const resetLink = useResetLink();
  const [reset, setReset] = useState<{ user: UserDTO; link: ResetLinkDTO } | null>(null);

  const actionError = updateMember.error ?? renew.error ?? revoke.error ?? resetLink.error;

  const memberActions = (u: UserDTO): MenuItem[] => [
    u.role === "admin"
      ? { label: "Change to member", onSelect: () => updateMember.mutate({ id: u.id, role: "member" }) }
      : { label: "Make admin", onSelect: () => updateMember.mutate({ id: u.id, role: "admin" }) },
    ...(u.active ? [{ label: "Create password reset link", onSelect: () => resetLink.mutate(u.id, { onSuccess: (link) => setReset({ user: u, link }) }) }] : []),
    u.active
      ? { label: "Deactivate…", danger: true, onSelect: () => setConfirm(u) }
      : { label: "Reactivate", onSelect: () => updateMember.mutate({ id: u.id, active: true }) },
  ];

  return (
    <section className="card settings-card">
      <div className="card-header">
        <div><h2>Team members</h2><p>Manage people and their access to Northstar CRM.</p></div>
        {isAdmin && <Button icon="plus" onClick={() => setInviteOpen(true)}>Invite member</Button>}
      </div>

      {actionError && <div className="settings-alert"><FormAlert>{errorMessage(actionError)}</FormAlert></div>}

      <div className="members">
        {users.isPending && <p className="empty-note">Loading team…</p>}
        {users.isError && <div className="settings-alert"><FormAlert>{errorMessage(users.error)}</FormAlert></div>}
        {users.data?.map((u) => (
          <div className={`member-row ${u.active ? "" : "inactive"}`} key={u.id}>
            <Avatar initials={initialsOf(u.name)} color={u.avatarColor} />
            <div><b>{u.name} {u.id === me.id && <Badge tone="violet">You</Badge>}</b><small>{u.email}</small></div>
            <Badge tone={u.role === "admin" ? "violet" : "gray"}>{u.role === "admin" ? "Admin" : "Member"}</Badge>
            <span className={!u.active ? "status-inactive" : u.status === "away" ? "status-away" : "status-active"}>{!u.active ? "Deactivated" : u.status === "away" ? "Away" : "Active"}</span>
            {isAdmin && u.id !== me.id ? <Menu label={`Actions for ${u.name}`} trigger={<Icon name="more" />} items={memberActions(u)} /> : <span className="menu-spacer" />}
          </div>
        ))}
      </div>

      {isAdmin && (invites.data?.length ?? 0) > 0 && (
        <>
          <h3 className="settings-subhead">Pending invites</h3>
          <div className="members">
            {invites.data!.map((inv) => (
              <div className="member-row" key={inv.id}>
                <Avatar initials={inv.email[0]!.toUpperCase()} color="gray" />
                <div><b>{inv.email}</b><small>Invite expires in {daysLeft(inv.expiresAt)} day{daysLeft(inv.expiresAt) === 1 ? "" : "s"}</small></div>
                <Badge tone={inv.role === "admin" ? "violet" : "gray"}>{inv.role === "admin" ? "Admin" : "Member"}</Badge>
                <span className="status-pending">Pending</span>
                <Menu label={`Actions for invite to ${inv.email}`} trigger={<Icon name="more" />} items={[
                  { label: "Get a new link", onSelect: () => renew.mutate(inv.id, { onSuccess: setRenewed }) },
                  { label: "Revoke invite", danger: true, onSelect: () => revoke.mutate(inv.id) },
                ]} />
              </div>
            ))}
          </div>
        </>
      )}

      {inviteOpen && <InviteDialog onClose={() => setInviteOpen(false)} />}
      {renewed && (
        <Dialog title="New invite link" onClose={() => setRenewed(null)} footer={<Button onClick={() => setRenewed(null)}>Done</Button>}>
          <InviteLink result={renewed} />
        </Dialog>
      )}
      {reset && (
        <Dialog title={`Password reset link for ${reset.user.name}`} description="Send this link to them. It works once and expires in 24 hours; using it signs them out everywhere." onClose={() => setReset(null)} footer={<Button onClick={() => setReset(null)}>Done</Button>}>
          <ResetLinkBox url={reset.link.resetUrl} />
        </Dialog>
      )}
      {confirm && (
        <Dialog
          title={`Deactivate ${confirm.name}?`}
          description="They'll be signed out immediately and won't be able to sign in. Their leads and history stay in place, and you can reactivate them later."
          onClose={() => setConfirm(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => updateMember.mutate({ id: confirm.id, active: false }, { onSettled: () => setConfirm(null) })}>Deactivate</Button>
          </>}
        >
          <span />
        </Dialog>
      )}
    </section>
  );
}

function ResetLinkBox({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-row">
      <input readOnly aria-label="Password reset link" value={url} onFocus={(e) => e.currentTarget.select()} />
      <Button variant="secondary" onClick={() => navigator.clipboard.writeText(url).then(() => setCopied(true), () => setCopied(false))}>{copied ? "Copied" : "Copy link"}</Button>
    </div>
  );
}
