import type { IncomingMessage, ServerResponse } from "node:http";
import { waitUntil } from "@vercel/functions";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { openDatabase, type DbHandle } from "./db/client";
import { runJobsIfDue } from "./jobs";
import { trackError } from "./lib/errorTracker";

/**
 * Vercel Function entry: the whole API runs as one function at /api.
 * The Fastify app is built once per warm instance and reused across requests.
 * Migrations are not run here; the build runs them (scripts/build-vercel.mjs).
 */
let ready: Promise<{ app: FastifyInstance; handle: DbHandle }> | null = null;
/** Per instance: how often to ask the database whether reminders are due (the database lock decides who runs them). */
const JOBS_CHECK_MS = 60_000;
let lastJobsCheck = 0;

function getApp() {
  ready ??= (async () => {
    const handle = await openDatabase();
    const app = await buildApp(handle);
    await app.ready();
    return { app, handle };
  })().catch((error) => {
    ready = null; // let the next request retry a failed cold start
    throw error;
  });
  return ready;
}

/** vercel.json rewrites /api/<path> to this function as /api?__path=<path>; put the original URL back. */
function restoreUrl(req: IncomingMessage) {
  const url = new URL(req.url ?? "/", "http://internal");
  const original = url.searchParams.get("__path");
  if (original === null) return;
  url.searchParams.delete("__path");
  const query = url.searchParams.toString();
  req.url = `/api/${original.replace(/^\/+/, "")}${query ? `?${query}` : ""}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  restoreUrl(req);
  try {
    const { app, handle } = await getApp();
    // Reminders run on traffic: at most once a minute per instance, check whether the jobs are
    // due, alongside this request. waitUntil keeps the function alive until the check finishes.
    // It must be called here, inside the request's async context: from a Fastify response hook
    // the context is gone and waitUntil silently does nothing. The daily cron is the backstop.
    if (Date.now() - lastJobsCheck >= JOBS_CHECK_MS) {
      lastJobsCheck = Date.now();
      waitUntil(
        runJobsIfDue(handle.db).then(
          (result) => { if (result) app.log.info({ jobs: result }, "Background jobs ran"); },
          (error) => {
            app.log.error({ err: error }, "Background jobs failed");
            return trackError(handle.db, { source: "server", message: `Background jobs failed: ${(error as Error).message}`, stack: (error as Error).stack, path: "jobs" });
          },
        ),
      );
    }
    app.server.emit("request", req, res);
  } catch (error) {
    console.error("API failed to start", error);
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "unavailable", message: "The server is starting or misconfigured. Try again shortly." }));
  }
}
