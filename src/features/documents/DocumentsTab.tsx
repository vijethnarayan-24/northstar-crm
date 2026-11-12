import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent } from "react";
import { ALLOWED_UPLOADS, type DocumentDTO, type ShareLinkDTO, type UploadStartDTO } from "@crm/shared";
import FormAlert from "@/components/form/FormAlert";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import Icon from "@/components/ui/Icon";
import Menu from "@/components/ui/Menu";
import { leadKeys, useLeadDocuments } from "@/features/leads/useLeads";
import { ConfirmDialog } from "@/features/settings/SettingsParts";
import { api, apiUrl, errorMessage } from "@/lib/api";
import { formatBytes, formatDate, relativeTime } from "@/lib/format";
import { SkeletonList } from "@/components/ui/Skeleton";

const ACCEPT = Object.keys(ALLOWED_UPLOADS).map((ext) => `.${ext}`).join(",");
const PREVIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Uploads one file. On Vercel the API hands out a one-file token and the browser sends the
 * file straight to private Blob storage (Vercel functions can't receive large bodies); the
 * API then checks it and records the document. Elsewhere the file is posted to the API.
 */
async function uploadDocument(leadId: string, file: File) {
  const { direct } = await api.post<UploadStartDTO>(`/leads/${leadId}/documents/uploads`, { filename: file.name, sizeBytes: file.size });
  if (!direct) {
    const form = new FormData();
    form.append("file", file);
    return api.upload<{ document: DocumentDTO }>(`/leads/${leadId}/documents`, form);
  }
  const { put } = await import("@vercel/blob/client"); // loaded only when needed
  await put(direct.pathname, file, { access: "private", token: direct.clientToken, contentType: direct.contentType, multipart: file.size > 8 * 1024 * 1024 });
  return api.post<{ document: DocumentDTO }>(`/leads/${leadId}/documents/complete`, { pathname: direct.pathname, filename: file.name });
}

function useDocumentMutations(leadId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: leadKeys.tab(leadId, "documents") });
    qc.invalidateQueries({ queryKey: leadKeys.detail(leadId) });
  };
  return {
    upload: useMutation({
      meta: { success: (_d, file) => `Uploaded ${(file as File).name}` },
      mutationFn: (file: File) => uploadDocument(leadId, file),
      onSettled: refresh,
    }),
    remove: useMutation({ meta: { success: "Document deleted" }, mutationFn: (id: string) => api.delete(`/documents/${id}`), onSuccess: refresh }),
    share: useMutation({ meta: { success: "Share link created" }, mutationFn: ({ id, days }: { id: string; days: number }) => api.post<ShareLinkDTO>(`/documents/${id}/share`, { expiresInDays: days }), onSuccess: refresh }),
    unshare: useMutation({ meta: { success: "Share link turned off" }, mutationFn: (id: string) => api.delete(`/documents/${id}/share`), onSuccess: refresh }),
  };
}

function ShareDialog({ doc, leadId, onClose }: { doc: DocumentDTO; leadId: string; onClose: () => void }) {
  const { share, unshare } = useDocumentMutations(leadId);
  const [days, setDays] = useState(30);
  const [copied, setCopied] = useState(false);
  const link = share.data;
  return (
    <Dialog title={`Share ${doc.filename}`} description="Anyone with the link can open this file without signing in. Each view is counted, and the lead's owner is notified." onClose={onClose}
      footer={<>
        {doc.shared && !link && <Button variant="danger" disabled={unshare.isPending} onClick={() => unshare.mutate(doc.id, { onSuccess: onClose })}>Turn off link</Button>}
        <Button variant="secondary" onClick={onClose}>{link ? "Done" : "Cancel"}</Button>
        {!link && <Button disabled={share.isPending} onClick={() => share.mutate({ id: doc.id, days })}>{share.isPending ? "Creating…" : doc.shared ? "Create new link" : "Create link"}</Button>}
      </>}>
      <div className="dialog-form">
        {(share.error || unshare.error) && <FormAlert>{errorMessage(share.error ?? unshare.error)}</FormAlert>}
        {link ? <>
          <FormAlert tone="success">Link ready. It works until {formatDate(link.expiresAt)}.</FormAlert>
          <div className="copy-row">
            <input readOnly aria-label="Share link" value={link.shareUrl} onFocus={(e) => e.currentTarget.select()} />
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(link.shareUrl).then(() => setCopied(true), () => setCopied(false))}>{copied ? "Copied" : "Copy link"}</Button>
          </div>
        </> : <>
          {doc.shared && <FormAlert tone="info">A link is active until {formatDate(doc.shareExpiresAt)}. Creating a new one turns the old link off.</FormAlert>}
          <div className="field">
            <label htmlFor="share-days">Link expires after</label>
            <select id="share-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[7, 30, 90, 365].map((d) => <option key={d} value={d}>{d === 365 ? "1 year" : `${d} days`}</option>)}
            </select>
          </div>
        </>}
      </div>
    </Dialog>
  );
}

export default function DocumentsTab({ leadId }: { leadId: string }) {
  const docs = useLeadDocuments(leadId);
  const { upload, remove } = useDocumentMutations(leadId);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [failed, setFailed] = useState<{ name: string; error: string }[]>([]);
  const [sharing, setSharing] = useState<DocumentDTO | null>(null);
  const [deleting, setDeleting] = useState<DocumentDTO | null>(null);

  /** Uploads one at a time; files that fail are listed with their reason. */
  const uploadFiles = async (files: FileList | File[]) => {
    setFailed([]);
    for (const file of [...files]) {
      try {
        await upload.mutateAsync(file);
      } catch (error) {
        setFailed((list) => [...list, { name: file.name, error: errorMessage(error) }]);
      }
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
  };

  return <div>
    <div className={`dropzone ${dragging ? "dragging" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <Icon name="file" />
      <span>Drag files here or <button type="button" className="inline-link" onClick={() => input.current?.click()}>choose files</button></span>
      <small>PDF, images, Office documents, text/CSV or ZIP · up to 25 MB each</small>
      <input ref={input} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { if (e.target.files?.length) void uploadFiles(e.target.files); e.target.value = ""; }} />
    </div>
    {upload.isPending && <p className="muted-note tab-note" role="status">Uploading…</p>}
    {failed.map((f) => <div className="tab-note" key={f.name}><FormAlert>{f.name}: {f.error}</FormAlert></div>)}
    {remove.isError && <div className="tab-note"><FormAlert>{errorMessage(remove.error)}</FormAlert></div>}

    {docs.isPending && <SkeletonList rows={2}/>}
    {docs.isError && <div className="tab-note"><FormAlert>{errorMessage(docs.error)}</FormAlert></div>}
    {docs.data?.length === 0 && <p className="empty-note tab-note">No documents yet.</p>}
    <div className="tab-list">{docs.data?.map((d) => (
      <div key={d.id}>
        <span className="file-icon"><Icon name="file" /></span>
        <div>
          <a className="doc-name" href={apiUrl(`/documents/${d.id}/download${PREVIEWABLE.has(d.mimeType) ? "?inline=1" : ""}`)} target="_blank" rel="noopener"><b>{d.filename}</b></a>
          <small>{formatBytes(d.sizeBytes)} · Uploaded {formatDate(d.createdAt)}{d.uploadedBy ? ` by ${d.uploadedBy.name.split(" ")[0]}` : ""}{d.lastViewedAt ? ` · Last viewed ${relativeTime(d.lastViewedAt).toLowerCase()}` : ""}</small>
        </div>
        <Badge tone={d.viewCount ? "green" : d.shared ? "blue" : "gray"}>{d.viewCount ? `Viewed ${d.viewCount}×` : d.shared ? "Shared" : "Not shared"}</Badge>
        <Menu label={`Actions for ${d.filename}`} trigger={<Icon name="more" />} items={[
          ...(PREVIEWABLE.has(d.mimeType) ? [{ label: "Preview", onSelect: () => window.open(apiUrl(`/documents/${d.id}/download?inline=1`), "_blank", "noopener") }] : []),
          { label: "Download", onSelect: () => { window.location.href = apiUrl(`/documents/${d.id}/download`); } },
          ...(d.canManage ? [
            { label: d.shared ? "Manage share link…" : "Share link…", onSelect: () => setSharing(d) },
            { label: "Delete…", danger: true, onSelect: () => setDeleting(d) },
          ] : []),
        ]} />
      </div>
    ))}</div>

    {sharing && <ShareDialog doc={sharing} leadId={leadId} onClose={() => setSharing(null)} />}
    {deleting && <ConfirmDialog title={`Delete ${deleting.filename}?`} description="The file is removed permanently and any share link stops working." confirmLabel="Delete file"
      pending={remove.isPending} error={remove.error} onClose={() => { setDeleting(null); remove.reset(); }} onConfirm={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })} />}
  </div>;
}
