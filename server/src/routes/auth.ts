import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { acceptInviteInput, forgotPasswordInput, loginInput, resetPasswordInput } from "@crm/shared";
import { endSession, revokeSessions, startSession, toUserDTO } from "../auth/session";
import { schema } from "../db/client";
import { env } from "../env";
import { httpError } from "../lib/errors";
import { hashPassword, verifyPassword } from "../lib/password";
import { isBlocked, recordFailure, recordSuccess } from "../lib/loginThrottle";
import { hashToken, randomToken } from "../lib/tokens";

const { users, invitations, passwordResets } = schema;
const RESET_TTL_MS = 60 * 60_000;

// Verified against when the email is unknown, so response time doesn't reveal which emails exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword("not-a-real-password-" + randomToken()));

const authRateLimit = { rateLimit: { max: 10, timeWindow: "15 minutes" } };

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/login", { config: authRateLimit }, async (request, reply) => {
    const { email, password } = loginInput.parse(request.body);
    if (await isBlocked(app.db, email)) throw httpError(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.");
    const [user] = await app.db.select().from(users).where(eq(sql`lower(${users.email})`, email)).limit(1);
    const ok = user?.passwordHash ? await verifyPassword(user.passwordHash, password) : (await verifyPassword(await getDummyHash(), password), false);
    if (!user || !ok) {
      if (await recordFailure(app.db, email)) request.log.warn({ security: "login_throttled", ip: request.ip }, "Account login temporarily blocked after repeated failures");
      throw httpError(401, "invalid_credentials", "Email or password is incorrect.");
    }
    await recordSuccess(app.db, email);
    if (user.deactivatedAt) throw httpError(403, "deactivated", "This account has been deactivated. Ask a workspace admin to restore access.");
    await startSession(app.db, reply, user.id);
    return { user: toUserDTO(user) };
  });

  app.post("/logout", async (request, reply) => {
    await endSession(app.db, request, reply);
    return reply.status(204).send();
  });

  // ---------- Invitations (public side) ----------
  const findOpenInvite = async (token: string) => {
    const [invite] = await app.db
      .select()
      .from(invitations)
      .where(and(eq(invitations.tokenHash, hashToken(token)), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
      .limit(1);
    if (!invite) throw httpError(404, "invite_invalid", "This invite link is invalid or has expired. Ask an admin for a new one.");
    return invite;
  };

  app.get("/invite/:token", async (request) => {
    const { token } = z.object({ token: z.string().min(20) }).parse(request.params);
    const invite = await findOpenInvite(token);
    return { email: invite.email, role: invite.role };
  });

  app.post("/accept-invite", { config: authRateLimit }, async (request, reply) => {
    const input = acceptInviteInput.parse(request.body);
    const invite = await findOpenInvite(input.token);
    const passwordHash = await hashPassword(input.password);
    const user = await app.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, invite.email.toLowerCase())).limit(1);
      if (existing) throw httpError(409, "already_member", "An account with this email already exists. Sign in instead.");
      const [created] = await tx.insert(users).values({ name: input.name, email: invite.email, role: invite.role, passwordHash }).returning();
      await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invite.id));
      return created;
    });
    await startSession(app.db, reply, user.id);
    return reply.status(201).send({ user: toUserDTO(user) });
  });

  // ---------- Password reset ----------
  app.post("/forgot", { config: authRateLimit }, async (request, reply) => {
    const { email } = forgotPasswordInput.parse(request.body);
    const [user] = await app.db
      .select()
      .from(users)
      .where(and(eq(sql`lower(${users.email})`, email), isNull(users.deactivatedAt)))
      .limit(1);
    if (user) {
      const token = randomToken();
      await app.db.insert(passwordResets).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) });
      await app.mailer.send({
        to: user.email,
        subject: "Reset your Northstar CRM password",
        text: `Hi ${user.name},\n\nUse this link within the next hour to choose a new password:\n${env.APP_URL}/reset/${token}\n\nIf you didn't ask for this, you can ignore this email.`,
      });
    }
    // Same response whether or not the account exists.
    return reply.status(204).send();
  });

  app.post("/reset", { config: authRateLimit }, async (request, reply) => {
    const { token, password } = resetPasswordInput.parse(request.body);
    const [reset] = await app.db
      .select()
      .from(passwordResets)
      .where(and(eq(passwordResets.tokenHash, hashToken(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())))
      .limit(1);
    if (!reset) throw httpError(400, "reset_invalid", "This reset link is invalid or has expired. Request a new one.");
    const passwordHash = await hashPassword(password);
    await app.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, reset.userId));
      await tx.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.userId, reset.userId));
    });
    await revokeSessions(app.db, reset.userId);
    return reply.status(204).send();
  });
};

export default authRoutes;
