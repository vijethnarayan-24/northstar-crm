import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { changePasswordInput, profileUpdate } from "@crm/shared";
import { currentUser, requireAuth, revokeSessions, toUserDTO } from "../auth/session";
import { schema } from "../db/client";
import { httpError } from "../lib/errors";
import { hashPassword, verifyPassword } from "../lib/password";

const meRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/", async (request) => ({ user: toUserDTO(currentUser(request)) }));

  app.patch("/", async (request) => {
    const me = currentUser(request);
    const changes = profileUpdate.parse(request.body);
    const [updated] = await app.db.update(schema.users).set(changes).where(eq(schema.users.id, me.id)).returning();
    return { user: toUserDTO(updated) };
  });

  app.post("/password", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const me = currentUser(request);
    const { currentPassword, newPassword } = changePasswordInput.parse(request.body);
    if (!me.passwordHash || !(await verifyPassword(me.passwordHash, currentPassword))) {
      throw httpError(400, "wrong_password", "Current password is incorrect.");
    }
    await app.db.update(schema.users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(schema.users.id, me.id));
    // Sign out other devices, keep this one.
    await revokeSessions(app.db, me.id, request.sessionId);
    return reply.status(204).send();
  });
};

export default meRoutes;
