import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { env } from "../env";
import { httpError } from "../lib/errors";
import { runJobsIfDue } from "../jobs";

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Scheduled entry point for the reminder and clean-up jobs (Vercel Cron calls it with
 * "Authorization: Bearer $CRON_SECRET"). Off unless CRON_SECRET is set. Uses the same
 * once-per-interval lock as the other triggers, so overlapping runs are harmless.
 */
const cronRoutes: FastifyPluginAsync = async (app) => {
  app.get("/cron/jobs", async (request) => {
    if (!env.CRON_SECRET) throw httpError(404, "not_found", "Not found");
    const header = request.headers.authorization ?? "";
    if (!sameSecret(header, `Bearer ${env.CRON_SECRET}`)) throw httpError(401, "unauthorized", "Missing or wrong cron secret.");
    const result = await runJobsIfDue(app.db, 1);
    return { ran: !!result, result };
  });
};

export default cronRoutes;
