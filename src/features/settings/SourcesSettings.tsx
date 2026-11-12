import { useState } from "react";
import type { SourceAdminDTO } from "@crm/shared";
import { useCurrentUser } from "@/auth/useAuth";
import FormAlert from "@/components/form/FormAlert";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Menu from "@/components/ui/Menu";
import { errorMessage } from "@/lib/api";
import { ConfirmDialog, countLabel, NameColorDialog, SortableRows } from "./SettingsParts";
import { useCreateSource, useDeleteSource, useReorder, useSourcesAdmin, useUpdateSource } from "./useSettings";
import { SkeletonList } from "@/components/ui/Skeleton";

export default function SourcesSettings() {
  const isAdmin = useCurrentUser().role === "admin";
  const sources = useSourcesAdmin();
  const create = useCreateSource();
  const update = useUpdateSource();
  const remove = useDeleteSource();
  const reorder = useReorder("sources");
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; source: SourceAdminDTO } | { mode: "delete"; source: SourceAdminDTO } | null>(null);
  const close = () => { setDialog(null); create.reset(); update.reset(); remove.reset(); };

  const active = sources.data?.filter((s) => !s.archived) ?? [];
  const archived = sources.data?.filter((s) => s.archived) ?? [];

  return (
    <section className="card settings-card">
      <div className="card-header"><div><h2>Lead sources</h2><p>Where leads come from. Drag to set the order used in forms and filters.</p></div>{isAdmin && <Button icon="plus" onClick={() => setDialog({ mode: "add" })}>Add source</Button>}</div>
      {(sources.error || update.error || reorder.error) && <div className="settings-alert"><FormAlert>{errorMessage(sources.error ?? update.error ?? reorder.error)}</FormAlert></div>}
      <div className="setting-list">
        {sources.isPending && <SkeletonList rows={4} avatar={false}/>}
        <SortableRows items={active} canReorder={isAdmin} onReorder={(ids) => reorder.mutate(ids)} render={(s) => <>
          <span className={`drag-dot bg-${s.color}`} /><b>{s.name}</b><small>{countLabel(s.leadCount)}</small>
          {isAdmin ? <Menu label={`Actions for ${s.name}`} trigger={<Icon name="more" />} items={[
            { label: "Edit", onSelect: () => setDialog({ mode: "edit", source: s }) },
            s.leadCount > 0
              ? { label: "Archive", onSelect: () => update.mutate({ id: s.id, archived: true }) }
              : { label: "Delete…", danger: true, onSelect: () => setDialog({ mode: "delete", source: s }) },
          ]} /> : <span className="menu-spacer" />}
        </>} />
      </div>
      {archived.length > 0 && <>
        <h3 className="settings-subhead">Archived</h3>
        <p className="muted-note settings-hint">Hidden from new leads and filters. Existing leads keep them.</p>
        <div className="setting-list">
          {archived.map((s) => <div className="setting-row archived" key={s.id}><span className="drag-handle-spacer" /><span className={`drag-dot bg-${s.color}`} /><b>{s.name}</b><small>{countLabel(s.leadCount)}</small>
            {isAdmin ? <Menu label={`Actions for ${s.name}`} trigger={<Icon name="more" />} items={[
              { label: "Restore", onSelect: () => update.mutate({ id: s.id, archived: false }) },
              ...(s.leadCount === 0 ? [{ label: "Delete…", danger: true, onSelect: () => setDialog({ mode: "delete", source: s }) }] : []),
            ]} /> : <span className="menu-spacer" />}
          </div>)}
        </div>
      </>}

      {dialog?.mode === "add" && <NameColorDialog title="Add lead source" saveLabel="Add source" pending={create.isPending} error={create.error} onClose={close} onSave={(v) => create.mutate(v, { onSuccess: close })} />}
      {dialog?.mode === "edit" && <NameColorDialog title={`Edit ${dialog.source.name}`} initial={dialog.source} saveLabel="Save" pending={update.isPending} error={update.error} onClose={close} onSave={(v) => update.mutate({ id: dialog.source.id, ...v }, { onSuccess: close })} />}
      {dialog?.mode === "delete" && <ConfirmDialog title={`Delete ${dialog.source.name}?`} description="No leads use this source, so it can be removed completely." confirmLabel="Delete source" pending={remove.isPending} error={remove.error} onClose={close} onConfirm={() => remove.mutate(dialog.source.id, { onSuccess: close })} />}
    </section>
  );
}
