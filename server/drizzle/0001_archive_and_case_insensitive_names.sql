ALTER TABLE "lead_sources" DROP CONSTRAINT "lead_sources_name_unique";--> statement-breakpoint
ALTER TABLE "pipeline_stages" DROP CONSTRAINT "pipeline_stages_name_unique";--> statement-breakpoint
ALTER TABLE "tags" DROP CONSTRAINT "tags_name_unique";--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_sources_active_name_unique" ON "lead_sources" USING btree (lower("name")) WHERE "lead_sources"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_active_name_unique" ON "pipeline_stages" USING btree (lower("name")) WHERE "pipeline_stages"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_unique" ON "tags" USING btree (lower("name"));