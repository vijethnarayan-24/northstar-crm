import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { searchQuery, type SearchResultsDTO } from "@crm/shared";
import { requireAuth } from "../auth/session";
import { schema } from "../db/client";
import { toStageRef } from "../leads/queries";

const { leads, pipelineStages, tasks, documents } = schema;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** ⌘K search: leads by name/company/email (trigram-ranked), tasks by title, documents by file name. */
const searchRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/search", async (request): Promise<SearchResultsDTO> => {
    const { q } = searchQuery.parse(request.query);
    const term = `%${escapeLike(q)}%`;
    const visibleLead = isNull(leads.deletedAt);
    const [leadRows, taskRows, docRows] = await Promise.all([
      app.db
        .select({ lead: leads, stage: pipelineStages })
        .from(leads)
        .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
        .where(and(visibleLead, or(ilike(leads.fullName, term), ilike(leads.company, term), ilike(leads.email, term))))
        // Best match first: similarity() comes from pg_trgm.
        .orderBy(desc(sql`greatest(similarity(${leads.fullName}, ${q}), similarity(coalesce(${leads.company}, ''), ${q}))`), asc(leads.fullName))
        .limit(6),
      app.db
        .select({ task: tasks, lead: { id: leads.id, fullName: leads.fullName } })
        .from(tasks)
        .leftJoin(leads, eq(leads.id, tasks.leadId))
        .where(and(or(isNull(tasks.leadId), visibleLead), ilike(tasks.title, term)))
        .orderBy(sql`${tasks.completedAt} is not null`, sql`${tasks.dueAt} asc nulls last`)
        .limit(5),
      app.db
        .select({ doc: documents, lead: { id: leads.id, fullName: leads.fullName } })
        .from(documents)
        .innerJoin(leads, eq(leads.id, documents.leadId))
        .where(and(visibleLead, ilike(documents.filename, term)))
        .orderBy(desc(documents.createdAt))
        .limit(5),
    ]);
    return {
      leads: leadRows.map(({ lead, stage }) => ({ id: lead.id, fullName: lead.fullName, company: lead.company, email: lead.email, stage: toStageRef(stage) })),
      tasks: taskRows.map(({ task, lead }) => ({ id: task.id, title: task.title, dueAt: task.dueAt?.toISOString() ?? null, completedAt: task.completedAt?.toISOString() ?? null, lead: lead?.id ? lead : null })),
      documents: docRows.map(({ doc, lead }) => ({ id: doc.id, filename: doc.filename, lead })),
    };
  });
};

export default searchRoutes;
