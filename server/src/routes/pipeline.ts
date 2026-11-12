import { asc, isNull } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { pipelineQuery, type PipelineDTO } from "@crm/shared";
import { currentUser, requireAuth } from "../auth/session";
import { schema } from "../db/client";
import { listBoard, toStageRef } from "../leads/queries";

const pipelineRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/pipeline", async (request): Promise<PipelineDTO> => {
    const q = pipelineQuery.parse(request.query);
    const stages = await app.db.select().from(schema.pipelineStages).where(isNull(schema.pipelineStages.archivedAt)).orderBy(asc(schema.pipelineStages.position));
    const columns = await listBoard(app.db, q, stages.map((s) => s.id), currentUser(request));
    return {
      closedWithinDays: q.closedWithinDays,
      perColumn: q.perColumn,
      columns: stages.map((stage, i) => ({ stage: toStageRef(stage), ...columns[i]!, hasMore: columns[i]!.count > columns[i]!.leads.length })),
    };
  });
};

export default pipelineRoutes;
