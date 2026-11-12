import { Readable } from "node:stream";
import { del, get, head, issueSignedToken, presignUrl, put } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { TooLargeError, type Storage } from "./storage";

/** How long a browser may use an upload token or a download link. */
const UPLOAD_TTL_MS = 15 * 60_000;
const DOWNLOAD_TTL_MS = 5 * 60_000;

/**
 * Private Vercel Blob store. Files are never public: browsers upload with a one-file token
 * and download through short-lived presigned links that the API hands out after its own
 * permission checks. This keeps large files off the API function (Vercel caps request and
 * response bodies at about 4.5 MB).
 */
export function createBlobStorage(token: string): Storage {
  const isMissing = (error: unknown) => (error as Error)?.name === "BlobNotFoundError";

  return {
    async save(key, data, maxBytes) {
      // Only used by the multipart fallback; buffers so the size limit is enforced before upload.
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of data) {
        bytes += (chunk as Buffer).length;
        if (bytes > maxBytes) throw new TooLargeError("File is too large");
        chunks.push(chunk as Buffer);
      }
      if ((data as Readable & { truncated?: boolean }).truncated) throw new TooLargeError("File is too large");
      await put(key, Buffer.concat(chunks), { access: "private", token, addRandomSuffix: false, allowOverwrite: false });
      return bytes;
    },

    async open(key) {
      const result = await get(key, { access: "private", token }).catch((error) => (isMissing(error) ? null : Promise.reject(error)));
      if (!result || result.statusCode !== 200) return null;
      return { stream: Readable.fromWeb(result.stream as never), size: result.blob.size };
    },

    async remove(key) {
      await del(key, { token }).catch((error) => {
        if (!isMissing(error)) throw error;
      });
    },

    async createUpload(key, { contentType, maxBytes }) {
      const clientToken = await generateClientTokenFromReadWriteToken({
        token,
        pathname: key,
        allowedContentTypes: [contentType],
        maximumSizeInBytes: maxBytes,
        validUntil: Date.now() + UPLOAD_TTL_MS,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      return { clientToken };
    },

    async stat(key) {
      const info = await head(key, { token }).catch((error) => (isMissing(error) ? null : Promise.reject(error)));
      return info ? { size: info.size, contentType: info.contentType } : null;
    },

    async signedUrl(key) {
      const validUntil = Date.now() + DOWNLOAD_TTL_MS;
      const signed = await issueSignedToken({ token, pathname: key, operations: ["get"], validUntil });
      const { presignedUrl } = await presignUrl(signed, { operation: "get", pathname: key, access: "private", validUntil, useCache: false });
      return presignedUrl;
    },
  };
}
