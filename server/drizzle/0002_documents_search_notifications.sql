-- Trigram search needs pg_trgm (a trusted extension: the database owner can create it on PostgreSQL 13+).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE 'task.due';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "share_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "last_viewed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "leads_full_name_trgm_idx" ON "leads" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "leads_company_trgm_idx" ON "leads" USING gin ("company" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "leads_email_trgm_idx" ON "leads" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_event_unique" ON "notifications" USING btree ("user_id","event_id");