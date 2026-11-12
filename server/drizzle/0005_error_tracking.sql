ALTER TYPE "public"."event_type" ADD VALUE 'system.error';--> statement-breakpoint
CREATE TABLE "app_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"method" text,
	"path" text,
	"status" integer,
	"user_id" uuid,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"alerted_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "app_errors_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
ALTER TABLE "app_errors" ADD CONSTRAINT "app_errors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_errors_last_seen_idx" ON "app_errors" USING btree ("last_seen_at");