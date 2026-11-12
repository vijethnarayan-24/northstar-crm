import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { ALLOWED_UPLOADS, shareInput, uploadCompleteInput, uploadStartInput, type DocumentDTO, type ShareLinkDTO, type UploadStartDTO } from "@crm/shared";
import { currentUser, requireAuth } from "../auth/session";
import { schema } from "../db/client";
import { env } from "../env";
import { getLeadRow, toUserRef } from "../leads/queries";
import { httpError } from "../lib/errors";
import { recordEvent } from "../lib/events";
import { TooLargeError } from "../lib/storage";
import { hashToken, randomToken } from "../lib/tokens";

const { documents, users, leads } = schema;
const idParam = z.object({ id: z.uuid() });
type DocRow = typeof documents.$inferSelect;
type UserRow = typeof users.$inferSelect;

/** A view more than this long after the previous one is reported again in the feed. */
const VIEW_EVENT_GAP_MS = 60 * 60_000;
/** Types a browser may show inline; everything else is always downloaded. */
const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

const canManage = (user: UserRow, doc: DocRow, leadOwnerId: string | null) =>
  user.role === "admin" || doc.uploadedBy === user.id || (leadOwnerId !== null && leadOwnerId === user.id);

/** Strips paths and control characters; keeps the name readable. */
function cleanFilename(name: string) {
  const base = path.basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  return (base || "file").slice(0, 200);
}

const maxBytes = () => env.MAX_UPLOAD_MB * 1024 * 1024;

/** The stored MIME type for an allowed extension; anything else is refused. */
function checkType(filename: string) {
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mimeType = ALLOWED_UPLOADS[ext];
  if (!mimeType) throw httpError(415, "unsupported_type", `.${ext || "?"} files aren't allowed. Upload a PDF, image, Office document, text/CSV or ZIP file.`);
  return { ext, mimeType };
}

/** ASCII-only name for storage paths (the real name stays in the database). */
function storageSafeName(filename: string, ext: string) {
  const stem = path.basename(filename, path.extname(filename)).normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80);
  return `${stem || "file"}.${ext}`;
}

function contentDisposition(kind: "inline" | "attachment", filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function toDTO(d: DocRow, uploader: UserRow | null, viewer: UserRow, leadOwnerId: string | null): DocumentDTO {
  const now = Date.now();
  return {
    id: d.id,
    filename: d.filename,
    sizeBytes: d.sizeBytes,
    mimeType: d.mimeType,
    uploadedBy: toUserRef(uploader),
    createdAt: d.createdAt.toISOString(),
    sentAt: d.sentAt?.toISOString() ?? null,
    shared: !!d.shareTokenHash && (!d.shareExpiresAt || d.shareExpiresAt.getTime() > now),
    shareExpiresAt: d.shareExpiresAt?.toISOString() ?? null,
    firstViewedAt: d.firstViewedAt?.toISOString() ?? null,
    lastViewedAt: d.lastViewedAt?.toISOString() ?? null,
    viewCount: d.viewCount,
    canManage: canManage(viewer, d, leadOwnerId),
  };
}

const documentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  const loadDoc = async (id: string) => {
    const [row] = await app.db
      .select({ d: documents, uploader: users, leadOwnerId: leads.ownerId, leadDeleted: leads.deletedAt })
      .from(documents)
      .innerJoin(leads, eq(leads.id, documents.leadId))
      .leftJoin(users, eq(users.id, documents.uploadedBy))
      .where(eq(documents.id, id))
      .limit(1);
    if (!row || row.leadDeleted) throw httpError(404, "not_found", "This document doesn't exist or was deleted.");
    return row;
  };
  const loadManageable = async (id: string, me: UserRow) => {
    const row = await loadDoc(id);
    if (!canManage(me, row.d, row.leadOwnerId)) throw httpError(403, "forbidden", "Only the uploader, the lead's owner or an admin can do this.");
    return row;
  };

  app.get("/leads/:id/documents", async (request): Promise<{ documents: DocumentDTO[] }> => {
    const me = currentUser(request);
    const { id } = idParam.parse(request.params);
    const lead = await getLeadRow(app.db, id);
    if (!lead) throw httpError(404, "not_found", "This lead doesn't exist or was deleted.");
    const rows = await app.db.select({ d: documents, uploader: users }).from(documents).leftJoin(users, eq(users.id, documents.uploadedBy)).where(eq(documents.leadId, id)).orderBy(desc(documents.createdAt));
    return { documents: rows.map((r) => toDTO(r.d, r.uploader, me, lead.ownerId)) };
  });

  /** Multipart upload, field name "file". Anyone can add documents to any lead. */
  app.post("/leads/:id/documents", async (request, reply) => {
    const me = currentUser(request);
    const { id: leadId } = idParam.parse(request.params);
    const lead = await getLeadRow(app.db, leadId);
    if (!lead) throw httpError(404, "not_found", "This lead doesn't exist or was deleted.");
    if (!request.isMultipart()) throw httpError(400, "expected_file", "Upload a file using multipart/form-data with a field named “file”.");
    const file = await request.file();
    if (!file) throw httpError(400, "expected_file", "Choose a file to upload.");

    const filename = cleanFilename(file.filename);
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mimeType = ALLOWED_UPLOADS[ext];
    if (!mimeType) {
      file.file.resume();
      throw httpError(415, "unsupported_type", `.${ext || "?"} files aren't allowed. Upload a PDF, image, Office document, text/CSV or ZIP file.`);
    }
    const storageKey = `${leadId}/${randomUUID()}.${ext}`;
    let sizeBytes: number;
    try {
      sizeBytes = await app.storage.save(storageKey, file.file, env.MAX_UPLOAD_MB * 1024 * 1024);
    } catch (error) {
      if (error instanceof TooLargeError) throw httpError(413, "too_large", `Files can be up to ${env.MAX_UPLOAD_MB} MB.`);
      throw error;
    }
    if (sizeBytes === 0) {
      await app.storage.remove(storageKey);
      throw httpError(400, "empty_file", "That file is empty.");
    }
    const [doc] = await app.db.insert(documents).values({ leadId, filename, storageKey, sizeBytes, mimeType, uploadedBy: me.id }).returning();
    await recordEvent(app.db, { type: "document.uploaded", actorId: me.id, leadId, subjectId: doc.id, payload: { filename } });
    return reply.status(201).send({ document: toDTO(doc, me, me, lead.ownerId) });
  });

  /**
   * Direct uploads (Vercel Blob), step 1: checks type and size, then returns a token that lets the
   * browser upload exactly this one file. Returns `direct: null` when files go through the API instead.
   */
  app.post("/leads/:id/documents/uploads", async (request): Promise<UploadStartDTO> => {
    const { id: leadId } = idParam.parse(request.params);
    const { filename: raw, sizeBytes } = uploadStartInput.parse(request.body);
    if (!(await getLeadRow(app.db, leadId))) throw httpError(404, "not_found", "This lead doesn't exist or was deleted.");
    if (!app.storage.createUpload) return { direct: null };
    const filename = cleanFilename(raw);
    const { ext, mimeType } = checkType(filename);
    if (sizeBytes === 0) throw httpError(400, "empty_file", "That file is empty.");
    if (sizeBytes > maxBytes()) throw httpError(413, "too_large", `Files can be up to ${env.MAX_UPLOAD_MB} MB.`);
    // <lead>/<uuid>/<readable name>: unguessable, and downloads keep a sensible file name.
    const pathname = `${leadId}/${randomUUID()}/${storageSafeName(filename, ext)}`;
    const { clientToken } = await app.storage.createUpload(pathname, { contentType: mimeType, maxBytes: maxBytes() });
    return { direct: { pathname, clientToken, contentType: mimeType } };
  });

  /** Direct uploads, step 2: the file is in storage; verify it and record the document. */
  app.post("/leads/:id/documents/complete", async (request, reply) => {
    const me = currentUser(request);
    const { id: leadId } = idParam.parse(request.params);
    const { pathname, filename: raw } = uploadCompleteInput.parse(request.body);
    const lead = await getLeadRow(app.db, leadId);
    if (!lead) throw httpError(404, "not_found", "This lead doesn't exist or was deleted.");
    if (!app.storage.stat) throw httpError(400, "not_supported", "This server stores uploads itself; post the file to /leads/:id/documents.");
    // Only paths in the shape step 1 issues for this lead, and never one already recorded.
    if (!new RegExp(`^${leadId}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$`).test(pathname)) throw httpError(400, "bad_upload", "That upload doesn't belong to this lead.");
    const [taken] = await app.db.select({ id: documents.id }).from(documents).where(eq(documents.storageKey, pathname)).limit(1);
    if (taken) throw httpError(409, "already_recorded", "This upload was already added.");
    const filename = cleanFilename(raw);
    const { mimeType } = checkType(filename);
    const info = await app.storage.stat(pathname);
    if (!info) throw httpError(400, "upload_missing", "The upload didn't finish. Please try again.");
    if (info.size === 0 || info.size > maxBytes() || info.contentType !== mimeType) {
      await app.storage.remove(pathname);
      if (info.size > maxBytes()) throw httpError(413, "too_large", `Files can be up to ${env.MAX_UPLOAD_MB} MB.`);
      throw httpError(400, info.size === 0 ? "empty_file" : "bad_upload", info.size === 0 ? "That file is empty." : "The uploaded file doesn't match its name.");
    }
    const [doc] = await app.db.insert(documents).values({ leadId, filename, storageKey: pathname, sizeBytes: info.size, mimeType, uploadedBy: me.id }).returning();
    await recordEvent(app.db, { type: "document.uploaded", actorId: me.id, leadId, subjectId: doc.id, payload: { filename } });
    return reply.status(201).send({ document: toDTO(doc, me, me, lead.ownerId) });
  });

  /** Streams the file. `?inline=1` previews PDFs and images in the browser; other types always download. */
  app.get("/documents/:id/download", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const inline = (request.query as { inline?: string }).inline === "1";
    const { d } = await loadDoc(id);
    return sendFile(reply, d, inline);
  });

  const sendFile = async (reply: FastifyReply, d: DocRow, inline: boolean) => {
    // Object storage (Vercel Blob): hand the browser a short-lived private link instead of
    // proxying the bytes through the API.
    if (app.storage.signedUrl) return reply.header("Cache-Control", "private, no-store").redirect(await app.storage.signedUrl(d.storageKey), 302);
    const file = await app.storage.open(d.storageKey);
    if (!file) throw httpError(404, "file_missing", "The file for this document is missing from storage.");
    const showInline = inline && INLINE_TYPES.has(d.mimeType);
    return reply
      .header("Content-Type", d.mimeType)
      .header("Content-Length", String(file.size))
      .header("Content-Disposition", contentDisposition(showInline ? "inline" : "attachment", d.filename))
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
      .header("Cache-Control", "private, no-store")
      .send(file.stream);
  };

  app.delete("/documents/:id", async (request, reply) => {
    const me = currentUser(request);
    const { id } = idParam.parse(request.params);
    const { d } = await loadManageable(id, me);
    await app.db.delete(documents).where(eq(documents.id, id));
    await app.storage.remove(d.storageKey);
    return reply.status(204).send();
  });

  /** Creates (or replaces) the public share link. The raw token is returned once and only its hash is stored. */
  app.post("/documents/:id/share", async (request): Promise<ShareLinkDTO> => {
    const me = currentUser(request);
    const { id } = idParam.parse(request.params);
    const { expiresInDays } = shareInput.parse(request.body ?? {});
    const { d } = await loadManageable(id, me);
    const token = randomToken();
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);
    await app.db.update(documents).set({ shareTokenHash: hashToken(token), shareExpiresAt: expiresAt, sentAt: new Date() }).where(eq(documents.id, d.id));
    return { shareUrl: `${env.APP_URL}/api/v1/share/${token}`, expiresAt: expiresAt.toISOString() };
  });

  app.delete("/documents/:id/share", async (request, reply) => {
    const me = currentUser(request);
    const { id } = idParam.parse(request.params);
    await loadManageable(id, me);
    await app.db.update(documents).set({ shareTokenHash: null, shareExpiresAt: null }).where(eq(documents.id, id));
    return reply.status(204).send();
  });
};

/**
 * Public share links: no sign-in. Each view is counted; the feed hears about the first
 * view and then at most once an hour, so a client re-opening a PDF doesn't flood it.
 */
export const publicShareRoutes: FastifyPluginAsync = async (app) => {
  app.get("/share/:token", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { token } = z.object({ token: z.string().min(20).max(100) }).parse(request.params);
    const [row] = await app.db
      .select({ d: documents, lead: leads })
      .from(documents)
      .innerJoin(leads, eq(leads.id, documents.leadId))
      .where(and(eq(documents.shareTokenHash, hashToken(token)), isNotNull(documents.shareTokenHash), sql`(${documents.shareExpiresAt} is null or ${documents.shareExpiresAt} > now())`))
      .limit(1);
    if (!row || row.lead.deletedAt) {
      return reply.status(404).header("Content-Type", "text/html; charset=utf-8").header("X-Robots-Tag", "noindex")
        .send("<!doctype html><title>Link unavailable</title><body style=\"font-family:system-ui;padding:40px\"><h1>This link is no longer available</h1><p>Ask the sender for a new link.</p></body>");
    }
    const { d, lead } = row;
    const now = new Date();
    const announce = !d.lastViewedAt || now.getTime() - d.lastViewedAt.getTime() > VIEW_EVENT_GAP_MS;
    await app.db.update(documents).set({ viewCount: sql`${documents.viewCount} + 1`, firstViewedAt: d.firstViewedAt ?? now, lastViewedAt: now }).where(eq(documents.id, d.id));
    if (announce) {
      await recordEvent(app.db, { type: "document.viewed", actorId: null, leadId: lead.id, subjectId: d.id, payload: { filename: d.filename, viewer: lead.company ?? lead.fullName, uploaderId: d.uploadedBy } });
    }
    if (app.storage.signedUrl) {
      return reply.header("Cache-Control", "private, no-store").header("Referrer-Policy", "no-referrer").header("X-Robots-Tag", "noindex, nofollow")
        .redirect(await app.storage.signedUrl(d.storageKey), 302);
    }
    const file = await app.storage.open(d.storageKey);
    if (!file) return reply.status(404).send({ error: "file_missing", message: "The file is missing." });
    return reply
      .header("Content-Type", d.mimeType)
      .header("Content-Length", String(file.size))
      .header("Content-Disposition", contentDisposition(INLINE_TYPES.has(d.mimeType) ? "inline" : "attachment", d.filename))
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Robots-Tag", "noindex, nofollow")
      .header("Referrer-Policy", "no-referrer")
      .header("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
      .header("Cache-Control", "private, no-store")
      .send(file.stream);
  });
};


export default documentRoutes;
