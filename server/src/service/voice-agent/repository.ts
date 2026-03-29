import { eq } from "drizzle-orm";
import { db } from "@/db";
import { voiceAgentCallSession } from "@/db/voice-agent.schema";
import type {
  VoiceAgentCallDirection,
  VoiceAgentCallSessionRecord,
  VoiceAgentCallState,
  VoiceAgentThinkProfile,
} from "@/types/voice-agent";

function toSessionRecord(row: typeof voiceAgentCallSession.$inferSelect): VoiceAgentCallSessionRecord {
  return {
    id: row.id,
    patientId: row.patientId,
    patientName: row.patientName,
    contactId: row.contactId,
    contactName: row.contactName,
    recipientTelegramUserId: row.recipientTelegramUserId,
    direction: row.direction as VoiceAgentCallDirection,
    state: row.state as VoiceAgentCallState,
    thinkProfile: row.thinkProfile as VoiceAgentThinkProfile,
    transportMode: row.transportMode,
    requestId: row.requestId,
    summaryText: row.summaryText,
    failureReason: row.failureReason,
    latestTranscriptAt: row.latestTranscriptAt?.toISOString() ?? null,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class VoiceAgentRepository {
  async createSession(input: {
    id: string;
    patientId: string | null;
    patientName: string;
    contactId: string | null;
    contactName: string | null;
    recipientTelegramUserId: string | null;
    direction: VoiceAgentCallDirection;
    state: VoiceAgentCallState;
    thinkProfile: VoiceAgentThinkProfile;
    transportMode: string;
  }) {
    const inserted = await db
      .insert(voiceAgentCallSession)
      .values({
        id: input.id,
        patientId: input.patientId,
        patientName: input.patientName,
        contactId: input.contactId,
        contactName: input.contactName,
        recipientTelegramUserId: input.recipientTelegramUserId,
        direction: input.direction,
        state: input.state,
        thinkProfile: input.thinkProfile,
        transportMode: input.transportMode,
      })
      .returning();

    return toSessionRecord(inserted[0]!);
  }

  async updateSession(
    sessionId: string,
    changes: Partial<{
      state: VoiceAgentCallState;
      thinkProfile: VoiceAgentThinkProfile;
      requestId: string | null;
      summaryText: string | null;
      failureReason: string | null;
      latestTranscriptAt: Date | null;
      endedAt: Date | null;
    }>,
  ) {
    const updated = await db
      .update(voiceAgentCallSession)
      .set({
        ...changes,
        updatedAt: new Date(),
      })
      .where(eq(voiceAgentCallSession.id, sessionId))
      .returning();

    return updated[0] ? toSessionRecord(updated[0]) : null;
  }

  async getSession(sessionId: string) {
    const [row] = await db
      .select()
      .from(voiceAgentCallSession)
      .where(eq(voiceAgentCallSession.id, sessionId))
      .limit(1);

    return row ? toSessionRecord(row) : null;
  }
}

export const voiceAgentRepository = new VoiceAgentRepository();
