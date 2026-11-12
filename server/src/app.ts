import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError } from "fastify";
import { ZodError, z } from "zod";
import { registerSessionLoader } from "./auth/session";
import type { DbHandle } from "./db/client";
import { env, trustProxy } from "./env";
import { createLogMailer, type Mailer } from "./lib/mailer";
import { createPgRateLimitStore } from "./lib/rateLimitStore";
import { createDefaultStorage, type Storage } from "./lib/storage";
import documentRoutes, { publicShareRoutes } from "./routes/documents";
import authRoutes from "./routes/auth";
import cronRoutes from "./routes/cron";
import reportRoutes from "./routes/reports";
import calendarRoutes from "./routes/calendar";
import systemRoutes from "./routes/system";
import { trackError } from "./lib/errorTracker";
import healthRoutes from "./routes/health";
import leadRoutes from "./routes/leads";
import lookupRoutes from "./routes/lookups";
import pipelineRoutes from "./routes/pipeline";
import settingsRoutes from "./routes/settings";
import meRoutes from "./routes/me";
import insightRoutes from "./routes/insights";
import notificationRoutes from "./routes/notifications";
import searchRoutes from "./routes/search";
import teamRoutes from "./routes/team";
import workRoutes from "./routes/work";

declare module "fastify" {
  interface FastifyInstance {
    db: DbHandle["db"];
    mailer: Mailer;
    storage: Storage;
    /** Every registered route, for the permission-matrix test and the API reference. */
    routeList: { method: string; url: string }[];
  }
}

export interface AppOptions {
  logger?: boolean;
  mailer?: Mailer;
  storage?: Storage;
  /** Disable auth rate limits (tests). */
  rateLimit?: boolean;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function buildApp(handle: DbHandle, options: AppOptions = {}) {
  const app = Fastify({
    logger: options.logger === false ? false : { level: env.LOG_LEVEL },
    trustProxy,
  });

  // On Vercel, preview deployments get their own hostnames; allow this deployment's own URLs.
  const vercelHosts = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map((h) => `https://${h}`);
  const allowedOrigins = new Set([...env.WEB_ORIGIN.split(",").map((o) => o.trim()), new URL(env.APP_URL).origin, ...vercelHosts]);

  app.decorate("db", handle.db);
  const routeList: { method: string; url: string }[] = [];
  app.decorate("routeList", routeList);
  app.addHook("onRoute", (route) => {
    for (const method of [route.method].flat()) if (method !== "HEAD") routeList.push({ method, url: route.url });
  });
  app.decorate("storage", options.storage ?? (await createDefaultStorage()));
  app.decorate("mailer", options.mailer ?? createLogMailer(app.log, { includeBody: env.NODE_ENV !== "production" }));

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5 } });
  await app.register(cors, { origin: [...allowedOrigins], credentials: true, methods: ["GET", "POST", "PATCH", "PUT", "DELETE"] });
  // Per-route limits live in each route's `config.rateLimit`; they only apply when the plugin is registered.
  if (options.rateLimit !== false) await app.register(rateLimit, { global: false, enableDraftSpec: true, store: createPgRateLimitStore(handle.db) as never });

  // CSRF defence: browsers always send Origin on cross-site state-changing requests.
  // Combined with SameSite=Lax cookies, rejecting unknown origins blocks forged requests.
  app.addHook("onRequest", async (request, reply) => {
    if (SAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return reply.status(403).send({ error: "bad_origin", message: "Request origin not allowed." });
    }
  });

  // Baseline security headers on every API response (routes that serve files set stricter ones).
  app.addHook("onSend", async (_request, reply) => {
    if (!reply.hasHeader("X-Content-Type-Options")) reply.header("X-Content-Type-Options", "nosniff");
    if (!reply.hasHeader("Referrer-Policy")) reply.header("Referrer-Policy", "same-origin");
    reply.header("X-Frame-Options", "DENY");
    if (!reply.hasHeader("Cache-Control")) reply.header("Cache-Control", "no-store");
  });

  registerSessionLoader(app);

  app.setErrorHandler(async (error: FastifyError | ZodError, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: "validation_error", message: "Please check the highlighted fields.", issues: z.flattenError(error).fieldErrors });
    }
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error(error);
      // Stored for Settings → System status; admins are alerted when it's new.
      await trackError(app.db, { source: "server", message: error.message, stack: error.stack, method: request.method, path: request.url, status, userId: request.user?.id ?? null });
    }
    if (status === 429) return reply.status(429).send({ error: "rate_limited", message: "Too many attempts. Please wait a few minutes and try again." });
    if (status >= 500) return reply.status(status).send({ error: "internal_error", message: "Something went wrong" });
    const extra = (error as { extra?: Record<string, unknown> }).extra;
    return reply.status(status).send({ error: error.code ?? "error", message: error.message, ...extra });
  });

  app.setNotFoundHandler((request, reply) => reply.status(404).send({ error: "not_found", message: `No route for ${request.method} ${request.url}` }));

  await app.register(healthRoutes, { prefix: "/api/v1" });
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(meRoutes, { prefix: "/api/v1/me" });
  await app.register(teamRoutes, { prefix: "/api/v1" });
  await app.register(lookupRoutes, { prefix: "/api/v1" });
  await app.register(leadRoutes, { prefix: "/api/v1" });
  await app.register(pipelineRoutes, { prefix: "/api/v1" });
  await app.register(settingsRoutes, { prefix: "/api/v1" });
  await app.register(workRoutes, { prefix: "/api/v1" });
  await app.register(insightRoutes, { prefix: "/api/v1" });
  await app.register(documentRoutes, { prefix: "/api/v1" });
  await app.register(publicShareRoutes, { prefix: "/api/v1" });
  await app.register(notificationRoutes, { prefix: "/api/v1" });
  await app.register(searchRoutes, { prefix: "/api/v1" });
  await app.register(cronRoutes, { prefix: "/api/v1" });
  await app.register(reportRoutes, { prefix: "/api/v1" });
  await app.register(calendarRoutes, { prefix: "/api/v1" });
  await app.register(systemRoutes, { prefix: "/api/v1" });

  return app;
}
