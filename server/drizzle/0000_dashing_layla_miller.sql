CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "necessity_request" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"necessity_id" text NOT NULL,
	"caretaker_contact_id" text NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"label_snapshot" text NOT NULL,
	"message_snapshot" text NOT NULL,
	"status" text NOT NULL,
	"telegram_message_id" text,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp,
	"escalated_at" timestamp,
	"escalate_after_seconds" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_contact" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"role" text NOT NULL,
	"priority_rank" integer NOT NULL,
	"name" text NOT NULL,
	"relation" text NOT NULL,
	"phone_number" text NOT NULL,
	"phone_number_normalized" text NOT NULL,
	"telegram_user_id" text,
	"telegram_chat_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"last_resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_necessity" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"label" text NOT NULL,
	"internal_message" text NOT NULL,
	"svg_markup" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_telegram_session" (
	"patient_id" text PRIMARY KEY NOT NULL,
	"telegram_user_id" text,
	"session_path" text NOT NULL,
	"auth_state" text NOT NULL,
	"connected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"hardware_password_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "necessity_request" ADD CONSTRAINT "necessity_request_patient_id_user_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "necessity_request" ADD CONSTRAINT "necessity_request_necessity_id_patient_necessity_id_fk" FOREIGN KEY ("necessity_id") REFERENCES "public"."patient_necessity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "necessity_request" ADD CONSTRAINT "necessity_request_caretaker_contact_id_patient_contact_id_fk" FOREIGN KEY ("caretaker_contact_id") REFERENCES "public"."patient_contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_contact" ADD CONSTRAINT "patient_contact_patient_id_user_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_necessity" ADD CONSTRAINT "patient_necessity_patient_id_user_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_telegram_session" ADD CONSTRAINT "patient_telegram_session_patient_id_user_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "necessity_request_patient_status_idx" ON "necessity_request" USING btree ("patient_id","status");--> statement-breakpoint
CREATE INDEX "necessity_request_patient_chat_status_idx" ON "necessity_request" USING btree ("patient_id","telegram_chat_id","status");--> statement-breakpoint
CREATE INDEX "necessity_request_triggered_idx" ON "necessity_request" USING btree ("triggered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_contact_patient_phone_unique" ON "patient_contact" USING btree ("patient_id","phone_number_normalized");--> statement-breakpoint
CREATE INDEX "patient_contact_patient_role_rank_idx" ON "patient_contact" USING btree ("patient_id","role","priority_rank");--> statement-breakpoint
CREATE INDEX "patient_contact_patient_telegram_user_idx" ON "patient_contact" USING btree ("patient_id","telegram_user_id");--> statement-breakpoint
CREATE INDEX "patient_contact_patient_telegram_chat_idx" ON "patient_contact" USING btree ("patient_id","telegram_chat_id");--> statement-breakpoint
CREATE INDEX "patient_necessity_patient_sort_idx" ON "patient_necessity" USING btree ("patient_id","sort_order");--> statement-breakpoint
CREATE INDEX "patient_necessity_patient_active_idx" ON "patient_necessity" USING btree ("patient_id","is_active");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");