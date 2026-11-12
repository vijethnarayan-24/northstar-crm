import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { env } from "../env";

/**
 * File storage behind a small interface so an S3/R2 driver can replace the local disk
 * without touching the routes. Keys look like "<leadId>/<uuid>.pdf".
 */
export interface Storage {
  /** Writes the stream; resolves to the byte count. Rejects (and removes the partial file) if `maxBytes` is exceeded. */
  save(key: string, data: Readable, maxBytes: number): Promise<number>;
  open(key: string): Promise<{ stream: Readable; size: number } | null>;
  remove(key: string): Promise<void>;
  /**
   * Optional, for stores browsers upload to directly (Vercel Blob): a short-lived token that
   * allows exactly one upload to `key`, of this type and at most this size.
   */
  createUpload?(key: string, options: { contentType: string; maxBytes: number }): Promise<{ clientToken: string }>;
  /** Optional: size and type of a stored file (used to confirm a direct upload). */
  stat?(key: string): Promise<{ size: number; contentType: string } | null>;
  /** Optional: a short-lived URL to fetch the file from, instead of streaming it through the API. */
  signedUrl?(key: string): Promise<string>;
}

/** Vercel Blob when a token is configured, otherwise the local disk. */
export async function createDefaultStorage(): Promise<Storage> {
  if (env.BLOB_READ_WRITE_TOKEN) {
    const { createBlobStorage } = await import("./blobStorage");
    return createBlobStorage(env.BLOB_READ_WRITE_TOKEN);
  }
  return createLocalStorage();
}

export class TooLargeError extends Error {}

export function createLocalStorage(root = env.STORAGE_DIR): Storage {
  const resolve = (key: string) => {
    const full = path.resolve(root, key);
    // Keys are generated server-side, but never let one escape the storage root.
    if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  };
  return {
    async save(key, data, maxBytes) {
      const full = resolve(key);
      await mkdir(path.dirname(full), { recursive: true });
      let bytes = 0;
      data.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) data.destroy(new TooLargeError("File is too large"));
      });
      try {
        await pipeline(data, createWriteStream(full));
      } catch (error) {
        await rm(full, { force: true });
        throw error;
      }
      // @fastify/multipart truncates instead of erroring when its own limit is hit.
      if ((data as Readable & { truncated?: boolean }).truncated) {
        await rm(full, { force: true });
        throw new TooLargeError("File is too large");
      }
      return bytes;
    },
    async open(key) {
      const full = resolve(key);
      try {
        const info = await stat(full);
        return { stream: createReadStream(full), size: info.size };
      } catch {
        return null;
      }
    },
    async remove(key) {
      await rm(resolve(key), { force: true });
    },
  };
}
