import { useState } from "react";
import type { StageAdminDTO } from "@crm/shared";
import { useCurrentUser } from "@/auth/useAuth";
import FormAlert from "@/components/form/FormAlert";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Menu from "@/components/ui/Menu";
import { ApiError, errorMessage } from "@/lib/api";
import { ConfirmDialog, countLabel, NameColorDialog, SortableRows } from "./SettingsParts";
import { useCreateStage, useRemoveStage, useReorder, useStagesAdmin, useUpdateStage } from "./useSettings";
import { SkeletonList } from "@/components/ui/Skeleton";

function RemoveStageDialog({ stage, others, onClose }: { stage: StageAdminDTO; others: StageAdminDTO[]; onClose: () => void }) {
  const remove = useRemoveStage();
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? "");
  const fieldError = remove.error instanceof ApiError ? remove.error.issues.moveToStageId?.[0] : undefined;
  return (
    <ConfirmDialog
      title={`Remove ${stage.name}?`}
      description={stage.leadCount
        ? `${countLabel(stage.leadCount)} in this stage will move to the stage you choose. Their stage history keeps a record of the move.`
        : "No leads are in this stage. Past stage history will still show its name."}
      confirmLabel="Remove stage"
      pending={remove.isPending}
      error={fieldError ? null : remove.error}
      onClose={onClose}
      onConfirm={() => remove.mutate({ id: stage.id, moveToStageId: stage.leadCount ? moveTo : undefined }, { onSuccess: onClose })}
    >
      {stage.leadCount > 0 && (
        <div className={`field ${fieldError ? "has-error" : ""}`}>
          <label htmlFor="move-to">Move its leads to</label>
          <select id="move-to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            {others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {fieldError && <small className="field-error">{fieldError}</small>}
        </div>
      )}
    </ConfirmDialog>
  );
}

export default function StagesSettings() {
  const isAdmin = useCurrentUser().role === "admin";
  const stages = useStagesAdmin();
  const create = useCreateStage();
  const update = useUpdateStage();
  const reorder = useReorder("stages");
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; stage: StageAdminDTO } | { mode: "remove"; stage: StageAdminDTO } | null>(null);
  const close = () => { setDialog(null); create.reset(); update.reset(); };

  const open = stages.data?.filter((s) => s.kind === "open") ?? [];
  const closed = stages.data?.filter((s) => s.kind !== "open") ?? [];

  const menu = (s: StageAdminDTO) => isAdmin ? <Menu label={`Actions for ${s.name}`} trigger={<Icon name="more" />} items={[
    { label: "Edit", onSelect: () => setDialog({ mode: "edit", stage: s }) },
    ...(s.kind === "open" && open.length > 1 ? [{ label: "Remove…", danger: true, onSelect: () => setDialog({ mode: "remove", stage: s }) }] : []),
  ]} /> : <span className="menu-spacer" />;

  return (
    <section className="card settings-card">
      <div className="card-header"><div><h2>Pipeline stages</h2><p>The columns of your pipeline. Drag open stages to reorder; Won and Lost always come last.</p></div>{isAdmin && <Button icon="plus" onClick={() => setDialog({ mode: "add" })}>Add stage</Button>}</div>
      {(stages.error || reorder.error) && <div className="settings-alert"><FormAlert>{errorMessage(stages.error ?? reorder.error)}</FormAlert></div>}
      <div className="setting-list">
        {stages.isPending && <SkeletonList rows={5} avatar={false}/>}
        <SortableRows items={open} canReorder={isAdmin} onReorder={(ids) => reorder.mutate(ids)} render={(s) => <>
          <span className={`drag-dot bg-${s.color}`} /><b>{s.name}</b><small>{countLabel(s.leadCount)}</small>{menu(s)}
        </>} />
        {closed.map((s) => (
          <div className="setting-row" key={s.id}><span className="drag-handle-spacer" /><span className={`drag-dot bg-${s.color}`} />
            <b>{s.name} <Badge tone={s.kind === "won" ? "green" : "red"}>{s.kind === "won" ? "Won stage" : "Lost stage"}</Badge></b>
            <small>{countLabel(s.leadCount)}</small>{menu(s)}
          </div>
        ))}
      </div>

      {dialog?.mode === "add" && <NameColorDialog title="Add pipeline stage" description="New stages are added just before Won. You can drag them into place." saveLabel="Add stage" pending={create.isPending} error={create.error} onClose={close} onSave={(v) => create.mutate(v, { onSuccess: close })} />}
      {dialog?.mode === "edit" && <NameColorDialog title={`Edit ${dialog.stage.name}`} initial={dialog.stage} saveLabel="Save" pending={update.isPending} error={update.error} onClose={close} onSave={(v) => update.mutate({ id: dialog.stage.id, ...v }, { onSuccess: close })} />}
      {dialog?.mode === "remove" && <RemoveStageDialog stage={dialog.stage} others={open.filter((s) => s.id !== dialog.stage.id)} onClose={close} />}
    </section>
  );
}
