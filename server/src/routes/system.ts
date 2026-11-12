import { and, count, desc, eq, gte, isNotNull, isNull, max, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { clientErrorInput, errorListQuery, type AppErrorDTO, type SystemStatusDTO } from "@crm/shared";
import { requireAdmin } from "../auth/session";
import { schema } from "../db/client";
import { env } from "../env";
import { toUserRef } from "../leads/queries";
import { httpError } from "../lib/errors";
import { trackError } from "../lib/errorTracker";

const { appErrors, users, jobRuns } = schema;
const idParam = z.object({ id: z.uuid() });
const startedAt = new Date();

/**
 * Health and error tracking.
 *  - POST /client-errors: browsers report crashes (works signed out too, e.g. on the login page).
 *  - GET  /system/status, /system/errors and the resolve actions: admins only.
 */
const systemRoutes: FastifyPluginAsync = async (app) => {
  app.post("/client-errors", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const input = clientErrorInput.parse(request.body);
    await trackError(app.db, {
      source: "client",
      message: input.message,
      stack: input.stack,
      path: input.path,
      method: input.source ?? "react",
      userId: request.user?.id ?? null,
    });
    return reply.status(204).send();
  });

  app.register(async (admin) => {
    admin.addHook("preHandler", requireAdmin);

    admin.get("/system/status", async (): Promise<SystemStatusDTO> => {
      const t0 = performance.now();
      const dbOk = await app.db.execute(sql`select 1`).then(() => true, () => false);
      const latencyMs = dbOk ? Math.round(performance.now() - t0) : null;
      const [jobs, open, recent] = dbOk
        ? await Promise.all([
            app.db.select({ last: max(jobRuns.lastRunAt) }).from(jobRuns),
            app.db.select({ n: count() }).from(appErrors).where(isNull(appErrors.resolvedAt)),
            app.db.select({ n: count() }).from(appErrors).where(gte(appErrors.lastSeenAt, sql`now() - interval '24 hours'`)),
          ])
        : [[{ last: null }], [{ n: 0 }], [{ n: 0 }]];
      const lastRunAt = jobs[0]?.last ?? null;
      // Reminders run every JOBS_INTERVAL_MINUTES while the app is used, and daily via cron.
      const jobsOk = !!lastRunAt && Date.now() - new Date(lastRunAt).getTime() < 26 * 3600_000;
      const openErrors = Number(open[0]?.n ?? 0);
      return {
        overall: dbOk && jobsOk && openErrors === 0 ? "ok" : "degraded",
        database: { ok: dbOk, latencyMs },
        jobs: { lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null, ok: jobsOk },
        errors: { open: openErrors, last24h: Number(recent[0]?.n ?? 0) },
        storage: env.BLOB_READ_WRITE_TOKEN ? "blob" : "disk",
        email: { configured: false },
        deployment: {
          environment: process.env.VERCEL_ENV ?? env.NODE_ENV,
          region: process.env.VERCEL_REGION ?? null,
          commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
          startedAt: startedAt.toISOString(),
        },
        checkedAt: new Date().toISOString(),
      };
    });

    admin.get("/system/errors", async (request): Promise<{ errors: AppErrorDTO[] }> => {
      const q = errorListQuery.parse(request.query);
      const rows = await app.db
        .select({ e: appErrors, user: users })
        .from(appErrors)
        .leftJoin(users, eq(users.id, appErrors.userId))
        .where(q.status === "open" ? isNull(appErrors.resolvedAt) : isNotNull(appErrors.resolvedAt))
        .orderBy(desc(appErrors.lastSeenAt))
        .limit(q.limit);
      return {
        errors: rows.map(({ e, user }) => ({
          id: e.id, source: e.source as "server" | "client", message: e.message, stack: e.stack, method: e.method, path: e.path, status: e.status,
          user: toUserRef(user), count: e.count, firstSeenAt: e.firstSeenAt.toISOString(), lastSeenAt: e.lastSeenAt.toISOString(), resolvedAt: e.resolvedAt?.toISOString() ?? null,
        })),
      };
    });

    admin.post("/system/errors/:id/resolve", async (request, reply) => {
      const { id } = idParam.parse(request.params);
      const [row] = await app.db.update(appErrors).set({ resolvedAt: sql`now()` }).where(and(eq(appErrors.id, id), isNull(appErrors.resolvedAt))).returning({ id: appErrors.id });
      if (!row) throw httpError(404, "not_found", "That error doesn't exist or is already resolved.");
      return reply.status(204).send();
    });

    admin.post("/system/errors/resolve-all", async () => {
      const rows = await app.db.update(appErrors).set({ resolvedAt: sql`now()` }).where(isNull(appErrors.resolvedAt)).returning({ id: appErrors.id });
      return { resolved: rows.length };
    });
  });
};

export default systemRoutes;
