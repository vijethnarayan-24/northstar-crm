import { and, asc, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { inviteInput, memberUpdate, type InvitationDTO, type InviteCreatedDTO, type ResetLinkDTO } from "@crm/shared";
import { currentUser, requireAdmin, requireAuth, revokeSessions, toUserDTO } from "../auth/session";
import { schema, type Database } from "../db/client";
import { env } from "../env";
import { httpError } from "../lib/errors";
import { hashToken, randomToken } from "../lib/tokens";

const { users, invitations } = schema;
const INVITE_TTL_MS = 7 * 86_400_000;
const RESET_LINK_TTL_MS = 86_400_000;
const idParam = z.object({ id: z.uuid() });

const toInvitationDTO = (i: typeof invitations.$inferSelect): InvitationDTO => ({
  id: i.id,
  email: i.email,
  role: i.role,
  invitedBy: i.invitedBy,
  expiresAt: i.expiresAt.toISOString(),
  createdAt: i.createdAt.toISOString(),
});

const activeAdminCount = async (db: Database) => {
  const [{ value }] = await db.select({ value: count() }).from(users).where(and(eq(users.role, "admin"), isNull(users.deactivatedAt)));
  return value;
};

const teamRoutes: FastifyPluginAsync = async (app) => {
  const sendInvite = async (invite: typeof invitations.$inferSelect, token: string, inviterName: string): Promise<InviteCreatedDTO> => {
    const inviteUrl = `${env.APP_URL}/invite/${token}`;
    await app.mailer.send({
      to: invite.email,
      subject: `${inviterName} invited you to Northstar CRM`,
      text: `${inviterName} invited you to join Northstar CRM as ${invite.role === "admin" ? "an admin" : "a member"}.\n\nAccept the invite (valid for 7 days):\n${inviteUrl}`,
    });
    return { invitation: toInvitationDTO(invite), inviteUrl };
  };

  // ---------- Members ----------
  app.get("/users", { preHandler: requireAuth }, async () => {
    const rows = await app.db.select().from(users).orderBy(sql`${users.deactivatedAt} is not null`, asc(users.role), asc(users.name));
    return { users: rows.map(toUserDTO) };
  });

  app.patch("/users/:id", { preHandler: requireAdmin }, async (request) => {
    const me = currentUser(request);
    const { id } = idParam.parse(request.params);
    const changes = memberUpdate.parse(request.body);
    const [target] = await app.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!target) throw httpError(404, "not_found", "Member not found.");

    if (target.id === me.id && (changes.active === false || changes.role === "member")) {
      throw httpError(409, "self_lockout", "You can't remove your own admin access or deactivate yourself.");
    }
    const losesAdmin = target.role === "admin" && target.deactivatedAt === null && (changes.role === "member" || changes.active === false);
    if (losesAdmin && (await activeAdminCount(app.db)) <= 1) {
      throw httpError(409, "last_admin", "The workspace needs at least one active admin.");
    }

    const set: Partial<typeof users.$inferInsert> = {};
    if (changes.role) set.role = changes.role;
    if (changes.active !== undefined) set.deactivatedAt = changes.active ? null : new Date();
    const [updated] = Object.keys(set).length
      ? await app.db.update(users).set(set).where(eq(users.id, id)).returning()
      : [target];
    if (changes.active === false) await revokeSessions(app.db, id);
    return { user: toUserDTO(updated) };
  });

  /**
   * Admin-issued password reset link (valid 24h), shown to the admin to pass on.
   * Stand-in for emailed resets until an email provider is configured.
   */
  app.post("/users/:id/reset-link", { preHandler: requireAdmin }, async (request): Promise<ResetLinkDTO> => {
    const me = currentUser(request);
    const { id } = idParam.parse(request.params);
    if (id === me.id) throw httpError(409, "use_change_password", "Change your own password from your profile.");
    const [target] = await app.db.select().from(users).where(and(eq(users.id, id), isNull(users.deactivatedAt))).limit(1);
    if (!target) throw httpError(404, "not_found", "Active member not found.");
    const token = randomToken();
    const expiresAt = new Date(Date.now() + RESET_LINK_TTL_MS);
    await app.db.insert(schema.passwordResets).values({ userId: id, tokenHash: hashToken(token), expiresAt });
    return { resetUrl: `${env.APP_URL}/reset/${token}`, expiresAt: expiresAt.toISOString() };
  });

  // ---------- Invitations ----------
  app.get("/invitations", { preHandler: requireAdmin }, async () => {
    const rows = await app.db
      .select()
      .from(invitations)
      .where(and(isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
      .orderBy(desc(invitations.createdAt));
    return { invitations: rows.map(toInvitationDTO) };
  });

  app.post("/invitations", { preHandler: requireAdmin }, async (request, reply) => {
    const me = currentUser(request);
    const { email, role } = inviteInput.parse(request.body);
    const [existing] = await app.db.select().from(users).where(eq(sql`lower(${users.email})`, email)).limit(1);
    if (existing) {
      throw existing.deactivatedAt
        ? httpError(409, "member_deactivated", `${existing.name} already has a deactivated account. Reactivate them instead.`)
        : httpError(409, "already_member", `${existing.name} is already a member.`);
    }
    const token = randomToken();
    const invite = await app.db.transaction(async (tx) => {
      // One open invite per email: a new invite replaces the old link.
      await tx.delete(invitations).where(and(eq(sql`lower(${invitations.email})`, email), isNull(invitations.acceptedAt)));
      const [row] = await tx
        .insert(invitations)
        .values({ email, role, tokenHash: hashToken(token), invitedBy: me.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
        .returning();
      return row;
    });
    return reply.status(201).send(await sendInvite(invite, token, me.name));
  });

  /** Issues a fresh link (and expiry) for an open invite. */
  app.post("/invitations/:id/renew", { preHandler: requireAdmin }, async (request) => {
    const me = currentUser(request);
    const { id } = idParam.parse(request.params);
    const token = randomToken();
    const [invite] = await app.db
      .update(invitations)
      .set({ tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
      .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt)))
      .returning();
    if (!invite) throw httpError(404, "not_found", "Invite not found.");
    return sendInvite(invite, token, me.name);
  });

  app.delete("/invitations/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    await app.db.delete(invitations).where(and(eq(invitations.id, id), isNull(invitations.acceptedAt)));
    return reply.status(204).send();
  });
};

export default teamRoutes;
