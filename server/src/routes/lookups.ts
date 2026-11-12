import { asc, eq, isNotNull, isNull, and, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { tagCreateInput, type LookupsDTO } from "@crm/shared";
import { requireAuth } from "../auth/session";
import { schema } from "../db/client";
import { toStageRef, toUserRef } from "../leads/queries";

const { leadSources, pipelineStages, tags, users, leads } = schema;

/** Reference data for forms and filters (sources, stages, tags, owners, lead types). */
const lookupRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/lookups", async (): Promise<LookupsDTO> => {
    const [sources, stages, tagRows, userRows, types] = await Promise.all([
      app.db.select().from(leadSources).where(isNull(leadSources.archivedAt)).orderBy(asc(leadSources.position), asc(leadSources.name)),
      app.db.select().from(pipelineStages).where(isNull(pipelineStages.archivedAt)).orderBy(asc(pipelineStages.position)),
      app.db.select().from(tags).orderBy(asc(tags.name)),
      app.db.select().from(users).where(isNull(users.deactivatedAt)).orderBy(asc(users.name)),
      app.db
        .selectDistinct({ leadType: leads.leadType })
        .from(leads)
        .where(and(isNull(leads.deletedAt), isNotNull(leads.leadType)))
        .orderBy(asc(leads.leadType)),
    ]);
    return {
      sources: sources.map((s) => ({ id: s.id, name: s.name, color: s.color })),
      stages: stages.map(toStageRef),
      tags: tagRows.map((t) => ({ id: t.id, name: t.name, color: t.color })),
      users: userRows.map((u) => toUserRef(u)!),
      leadTypes: types.map((t) => t.leadType!).filter(Boolean),
    };
  });

  /** Create a tag inline (any member). Returns the existing tag if the name is taken. */
  app.post("/tags", async (request, reply) => {
    const { name, color } = tagCreateInput.parse(request.body);
    const [existing] = await app.db.select().from(tags).where(eq(sql`lower(${tags.name})`, name.toLowerCase())).limit(1);
    if (existing) return { tag: { id: existing.id, name: existing.name, color: existing.color } };
    const [tag] = await app.db.insert(tags).values({ name, color }).returning();
    return reply.status(201).send({ tag: { id: tag.id, name: tag.name, color: tag.color } });
  });
};

export default lookupRoutes;
