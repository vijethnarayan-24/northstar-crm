import { useState } from "react";
import { LOST_REASONS, type LostReason } from "@crm/shared";
import FormAlert from "@/components/form/FormAlert";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { errorMessage } from "@/lib/api";
import { LOST_REASON_LABELS } from "./labels";

export default function LostDialog({ leadName, onConfirm, onClose, pending, error }: { leadName: string; onConfirm: (reason: LostReason, notes: string) => void; onClose: () => void; pending: boolean; error: unknown }) {
  const [reason, setReason] = useState<LostReason | "">("");
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState(false);

  return (
    <Dialog
      title={`Mark ${leadName} as lost?`}
      description="Help your team learn why this opportunity didn't move forward. You can move it back to an open stage later."
      onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={pending} onClick={() => { setTouched(true); if (reason) onConfirm(reason, notes); }}>{pending ? "Saving…" : "Mark as lost"}</Button>
      </>}
    >
      <div className="dialog-form">
        {error ? <FormAlert>{errorMessage(error)}</FormAlert> : null}
        <div className={`field ${touched && !reason ? "has-error" : ""}`}>
          <label htmlFor="lost-reason">Reason</label>
          <select id="lost-reason" value={reason} onChange={(e) => setReason(e.target.value as LostReason)} aria-invalid={touched && !reason ? true : undefined}>
            <option value="">Select a reason</option>
            {LOST_REASONS.map((r) => <option key={r} value={r}>{LOST_REASON_LABELS[r]}</option>)}
          </select>
          {touched && !reason && <small className="field-error">Choose a reason</small>}
        </div>
        <div className="field">
          <label htmlFor="lost-notes">Notes (optional)</label>
          <textarea id="lost-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add any useful context..." />
        </div>
      </div>
    </Dialog>
  );
}
