import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { patientContact, user } from "./schema";

export const voiceAgentCallSession = pgTable(
  "voice_agent_call_session",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id").references(() => user.id, { onDelete: "set null" }),
    patientName: text("patient_name").notNull(),
    contactId: text("contact_id").references(() => patientContact.id, { onDelete: "set null" }),
    contactName: text("contact_name"),
    recipientTelegramUserId: text("recipient_telegram_user_id"),
    direction: text("direction").notNull(),
    state: text("state").notNull(),
    thinkProfile: text("think_profile").notNull(),
    transportMode: text("transport_mode").notNull(),
    requestId: text("request_id"),
    summaryText: text("summary_text"),
    failureReason: text("failure_reason"),
    latestTranscriptAt: timestamp("latest_transcript_at"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("voice_agent_call_session_patient_idx").on(table.patientId),
    index("voice_agent_call_session_contact_idx").on(table.contactId),
    index("voice_agent_call_session_state_idx").on(table.state),
  ],
);
