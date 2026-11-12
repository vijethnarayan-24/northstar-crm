import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_request, reply) => {
    try {
      await app.db.execute(sql`select 1`);
      return { status: "ok", database: "up", time: new Date().toISOString() };
    } catch {
      return reply.status(503).send({ status: "degraded", database: "down", time: new Date().toISOString() });
    }
  });
};

export default healthRoutes;
