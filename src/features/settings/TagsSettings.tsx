import { useState } from "react";
import { Link } from "react-router";
import type { TagAdminDTO } from "@crm/shared";
import { useCurrentUser } from "@/auth/useAuth";
import FormAlert from "@/components/form/FormAlert";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Menu from "@/components/ui/Menu";
import { errorMessage } from "@/lib/api";
import { ConfirmDialog, countLabel, NameColorDialog } from "./SettingsParts";
import { useCreateTag, useDeleteTag, useMergeTag, useTagsAdmin, useUpdateTag } from "./useSettings";
import { SkeletonList } from "@/components/ui/Skeleton";

function MergeDialog({ tag, others, onClose }: { tag: TagAdminDTO; others: TagAdminDTO[]; onClose: () => void }) {
  const merge = useMergeTag();
  const [intoId, setIntoId] = useState(others[0]?.id ?? "");
  const into = others.find((t) => t.id === intoId);
  return (
    <ConfirmDialog title={`Merge ${tag.name}`} description={`Every lead tagged ${tag.name} gets the tag you choose instead, then ${tag.name} is deleted.`}
      confirmLabel={into ? `Merge into ${into.name}` : "Merge"} danger={false} pending={merge.isPending} error={merge.error} onClose={onClose}
      onConfirm={() => intoId && merge.mutate({ id: tag.id, intoId }, { onSuccess: onClose })}>
      <div className="field">
        <label htmlFor="merge-into">Merge into</label>
        <select id="merge-into" value={intoId} onChange={(e) => setIntoId(e.target.value)}>
          {others.map((t) => <option key={t.id} value={t.id}>{t.name} ({countLabel(t.leadCount)})</option>)}
        </select>
      </div>
    </ConfirmDialog>
  );
}

export default function TagsSettings() {
  const isAdmin = useCurrentUser().role === "admin";
  const tags = useTagsAdmin();
  const create = useCreateTag();
  const update = useUpdateTag();
  const remove = useDeleteTag();
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit" | "delete" | "merge"; tag: TagAdminDTO } | null>(null);
  const close = () => { setDialog(null); create.reset(); update.reset(); remove.reset(); };
  const list = tags.data ?? [];

  return (
    <section className="card settings-card">
      <div className="card-header"><div><h2>Tags</h2><p>Labels for grouping leads. Anyone can create tags while editing a lead; admins manage them here.</p></div>{isAdmin && <Button icon="plus" onClick={() => setDialog({ mode: "add" })}>Add tag</Button>}</div>
      {tags.error && <div className="settings-alert"><FormAlert>{errorMessage(tags.error)}</FormAlert></div>}
      <div className="setting-list">
        {tags.isPending && <SkeletonList rows={4} avatar={false}/>}
        {tags.data?.length === 0 && <p className="empty-note">No tags yet.</p>}
        {list.map((t) => (
          <div className="setting-row" key={t.id}><span className="drag-handle-spacer" />
            <Badge tone={t.color}>{t.name}</Badge>
            <span />
            {t.leadCount ? <Link className="text-button" to={`/leads?tagId=${t.id}`}>{countLabel(t.leadCount)}</Link> : <small>{countLabel(0)}</small>}
            {isAdmin ? <Menu label={`Actions for ${t.name}`} trigger={<Icon name="more" />} items={[
              { label: "Edit", onSelect: () => setDialog({ mode: "edit", tag: t }) },
              ...(list.length > 1 ? [{ label: "Merge into…", onSelect: () => setDialog({ mode: "merge", tag: t }) }] : []),
              { label: "Delete…", danger: true, onSelect: () => setDialog({ mode: "delete", tag: t }) },
            ]} /> : <span className="menu-spacer" />}
          </div>
        ))}
      </div>

      {dialog?.mode === "add" && <NameColorDialog title="Add tag" saveLabel="Add tag" pending={create.isPending} error={create.error} onClose={close} onSave={(v) => create.mutate(v, { onSuccess: close })} />}
      {dialog?.mode === "edit" && <NameColorDialog title={`Edit ${dialog.tag.name}`} initial={dialog.tag} saveLabel="Save" pending={update.isPending} error={update.error} onClose={close} onSave={(v) => update.mutate({ id: dialog.tag.id, ...v }, { onSuccess: close })} />}
      {dialog?.mode === "merge" && <MergeDialog tag={dialog.tag} others={list.filter((t) => t.id !== dialog.tag.id)} onClose={close} />}
      {dialog?.mode === "delete" && <ConfirmDialog title={`Delete ${dialog.tag.name}?`} description={dialog.tag.leadCount ? `It will be removed from ${countLabel(dialog.tag.leadCount)}. The leads themselves are not affected.` : "No leads use this tag."} confirmLabel="Delete tag" pending={remove.isPending} error={remove.error} onClose={close} onConfirm={() => remove.mutate(dialog.tag.id, { onSuccess: close })} />}
    </section>
  );
}
