import { and, eq, gt, isNull, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { UserDTO } from "@crm/shared";
import { schema, type Database } from "../db/client";
import { env } from "../env";
import { hashToken, randomToken } from "../lib/tokens";

export const SESSION_COOKIE = "crm_sid";
const DAY = 86_400_000;
const LAST_SEEN_THROTTLE_MS = 5 * 60_000;

type UserRow = typeof schema.users.$inferSelect;

declare module "fastify" {
  interface FastifyRequest {
    user: UserRow | null;
    sessionId: string | null;
  }
}

export const toUserDTO = (u: UserRow): UserDTO => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  avatarColor: u.avatarColor,
  status: u.status,
  active: u.deactivatedAt === null,
  lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
  createdAt: u.createdAt.toISOString(),
});

const cookieOptions = (expires: Date) => ({
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.NODE_ENV === "production",
  expires,
});

export async function startSession(db: Database, reply: FastifyReply, userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * DAY);
  await db.insert(schema.sessions).values({ id: hashToken(token), userId, expiresAt });
  await db.update(schema.users).set({ lastSeenAt: new Date() }).where(eq(schema.users.id, userId));
  reply.setCookie(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export async function endSession(db: Database, request: FastifyRequest, reply: FastifyReply) {
  if (request.sessionId) await db.delete(schema.sessions).where(eq(schema.sessions.id, request.sessionId));
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** Signs a user out everywhere, optionally keeping the current session. */
export async function revokeSessions(db: Database, userId: string, exceptSessionId?: string | null) {
  await db
    .delete(schema.sessions)
    .where(exceptSessionId ? and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, exceptSessionId)) : eq(schema.sessions.userId, userId));
}

/** Resolves request.user from the session cookie, with sliding expiry. */
export function registerSessionLoader(app: FastifyInstance) {
  app.decorateRequest("user", null);
  app.decorateRequest("sessionId", null);

  app.addHook("onRequest", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const id = hashToken(token);
    const now = new Date();
    const [row] = await app.db
      .select({ session: schema.sessions, user: schema.users })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, now), isNull(schema.users.deactivatedAt)))
      .limit(1);
    const absoluteEnd = row ? row.session.createdAt.getTime() + env.SESSION_MAX_DAYS * DAY : 0;
    if (!row || absoluteEnd <= now.getTime()) {
      if (row) await app.db.delete(schema.sessions).where(eq(schema.sessions.id, id));
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return;
    }
    request.user = row.user;
    request.sessionId = id;

    // Slide the expiry once less than half the lifetime remains.
    const ttl = env.SESSION_TTL_DAYS * DAY;
    if (row.session.expiresAt.getTime() - now.getTime() < ttl / 2) {
      const expiresAt = new Date(Math.min(now.getTime() + ttl, absoluteEnd));
      await app.db.update(schema.sessions).set({ expiresAt }).where(eq(schema.sessions.id, id));
      reply.setCookie(SESSION_COOKIE, token, cookieOptions(expiresAt));
    }
    if (!row.user.lastSeenAt || now.getTime() - row.user.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
      await app.db.update(schema.users).set({ lastSeenAt: now }).where(eq(schema.users.id, row.user.id));
    }
  });
}

/** preHandler guards */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) return reply.status(401).send({ error: "unauthenticated", message: "Please sign in." });
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) return reply.status(401).send({ error: "unauthenticated", message: "Please sign in." });
  if (request.user.role !== "admin") return reply.status(403).send({ error: "forbidden", message: "Only workspace admins can do this." });
}

/** Narrowing helper for handlers behind requireAuth. */
export const currentUser = (request: FastifyRequest): UserRow => {
  if (!request.user) throw Object.assign(new Error("Please sign in."), { statusCode: 401, code: "unauthenticated" });
  return request.user;
};
