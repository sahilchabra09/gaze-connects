import { Elysia, t } from "elysia";
import { auth } from "@/lib/auth";
import { logger, serializeError } from "@/lib/logger";
import { VoiceAgentDomainError, isVoiceAgentDomainError } from "@/service/voice-agent/errors";
import { voiceAgentSessionManager } from "@/service/voice-agent/session-manager";
import { voiceAgentSseBroker } from "@/service/voice-agent/sse-broker";

async function resolveOptionalSessionUser(request: Request) {
  const sessionData = await auth.api.getSession({ headers: request.headers });
  return sessionData?.user ?? null;
}

function formatError(error: string, message: string) {
  return { error, message };
}

function formatSseChunk(type: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function handleVoiceAgentError(set: { status?: number | string }, error: unknown) {
  if (isVoiceAgentDomainError(error)) {
    set.status = error.status;
    return formatError(error.code, error.message);
  }

  logger.error({ error: serializeError(error) }, "voice-agent route failed");
  set.status = 500;
  return formatError("VOICE_AGENT_INTERNAL_ERROR", "Voice agent request failed");
}

const nullableString = t.Union([t.String(), t.Null()]);
const nullableDateTime = t.Union([t.String({ format: "date-time" }), t.Null()]);

const callSessionSchema = t.Object({
  id: t.String(),
  patientId: nullableString,
  patientName: t.String(),
  contactId: nullableString,
  contactName: nullableString,
  recipientTelegramUserId: nullableString,
  direction: t.Union([t.Literal("incoming"), t.Literal("outgoing")]),
  state: t.String(),
  thinkProfile: t.String(),
  transportMode: t.String(),
  requestId: nullableString,
  summaryText: nullableString,
  failureReason: nullableString,
  startedAt: t.String({ format: "date-time" }),
  endedAt: nullableDateTime,
  latestTranscriptAt: nullableDateTime,
  createdAt: t.String({ format: "date-time" }),
  updatedAt: t.String({ format: "date-time" }),
});

const turnSchema = t.Object({
  id: t.String(),
  callSessionId: t.String(),
  role: t.String(),
  source: t.String(),
  content: t.String(),
  metadataJson: nullableString,
  createdAt: t.String({ format: "date-time" }),
});

const toolEventSchema = t.Object({
  id: t.String(),
  callSessionId: t.String(),
  functionCallId: nullableString,
  toolName: t.String(),
  status: t.String(),
  argumentsJson: nullableString,
  responseContent: nullableString,
  errorMessage: nullableString,
  createdAt: t.String({ format: "date-time" }),
});

const candidateReplySchema = t.Object({
  id: t.String(),
  callSessionId: t.String(),
  batchId: t.String(),
  ordinal: t.Integer(),
  label: t.String(),
  content: t.String(),
  selectedAt: nullableDateTime,
  createdAt: t.String({ format: "date-time" }),
});

const snapshotSchema = t.Object({
  session: callSessionSchema,
  turns: t.Array(turnSchema),
  toolEvents: t.Array(toolEventSchema),
  candidateReplies: t.Array(candidateReplySchema),
  latestAudioAvailable: t.Boolean(),
});

export const voiceAgentRoutes = new Elysia({
  prefix: "/voice-agent",
  detail: {
    tags: ["Voice Agent"],
  },
})
  .post(
    "/sessions",
    async ({ request, body, set }) => {
      try {
        const sessionUser = await resolveOptionalSessionUser(request);
        return await voiceAgentSessionManager.startSession({
          patientId: sessionUser?.id ?? null,
          patientName: body.patientName,
          contactId: null,
          contactName: body.contactName ?? null,
          recipientTelegramUserId: body.recipientTelegramUserId ?? null,
          direction: body.direction ?? "outgoing",
          transportMode: body.transportMode ?? "debug",
          useMock: body.useMock,
        });
      } catch (error) {
        return handleVoiceAgentError(set, error);
      }
    },
    {
      body: t.Object({
        patientName: t.String({ minLength: 1 }),
        contactName: t.Optional(t.String()),
        recipientTelegramUserId: t.Optional(t.String()),
        direction: t.Optional(t.Union([t.Literal("incoming"), t.Literal("outgoing")])),
        transportMode: t.Optional(t.String()),
        useMock: t.Optional(t.Boolean()),
      }),
      response: {
        200: snapshotSchema,
        500: t.Object({ error: t.String(), message: t.String() }),
      },
    },
  )
  .get(
    "/sessions/:sessionId",
    async ({ params, set }) => {
      try {
        return await voiceAgentSessionManager.getSnapshot(params.sessionId);
      } catch (error) {
        return handleVoiceAgentError(set, error);
      }
    },
    {
      params: t.Object({ sessionId: t.String() }),
      response: {
        200: snapshotSchema,
        404: t.Object({ error: t.String(), message: t.String() }),
        500: t.Object({ error: t.String(), message: t.String() }),
      },
    },
  )
  .post(
    "/sessions/:sessionId/simulate-user-turn",
    async ({ params, body, set }) => {
      try {
        return await voiceAgentSessionManager.simulateUserTurn(params.sessionId, body.text);
      } catch (error) {
        return handleVoiceAgentError(set, error);
      }
    },
    {
      params: t.Object({ sessionId: t.String() }),
      body: t.Object({ text: t.String({ minLength: 1 }) }),
      response: {
        200: snapshotSchema,
        404: t.Object({ error: t.String(), message: t.String() }),
        500: t.Object({ error: t.String(), message: t.String() }),
      },
    },
  )
  .post(
    "/sessions/:sessionId/select-candidate",
    async ({ params, body, set }) => {
      try {
        return await voiceAgentSessionManager.selectCandidateReply(params.sessionId, body.candidateId);
      } catch (error) {
        return handleVoiceAgentError(set, error);
      }
    },
    {
      params: t.Object({ sessionId: t.String() }),
      body: t.Object({ candidateId: t.String() }),
      response: {
        200: snapshotSchema,
        404: t.Object({ error: t.String(), message: t.String() }),
        500: t.Object({ error: t.String(), message: t.String() }),
      },
    },
  )
  .post(
    "/sessions/:sessionId/retry",
    async ({ params, set }) => {
      try {
        return await voiceAgentSessionManager.retryAnswer(params.sessionId);
      } catch (error) {
        return handleVoiceAgentError(set, error);
      }
    },
    {
      params: t.Object({ sessionId: t.String() }),
      response: {
        200: snapshotSchema,
        404: t.Object({ error: t.String(), message: t.String() }),
        500: t.Object({ error: t.String(), message: t.String() }),
      },
    },
  )
  .post(
    "/sessions/:sessionId/summarize",
    async ({ params, set }) => {
      try {
        return await voiceAgentSessionManager.summarizeCall(params.sessionId);
      } catch (error) {
        return handleVoiceAgentError(set, error);
      }
    },
    {
      params: t.Object({ sessionId: t.String() }),
      response: {
        200: snapshotSchema,
        404: t.Object({ error: t.String(), message: t.String() }),
        500: t.Object({ error: t.String(), message: t.String() }),
      },
    },
  )
  .post(
    "/sessions/:sessionId/end",
    async ({ params, set }) => {
      try {
        return await voiceAgentSessionManager.endSession(params.sessionId);
      } catch (error) {
        return handleVoiceAgentError(set, error);
      }
    },
    {
      params: t.Object({ sessionId: t.String() }),
      response: {
        200: snapshotSchema,
        404: t.Object({ error: t.String(), message: t.String() }),
        500: t.Object({ error: t.String(), message: t.String() }),
      },
    },
  )
  .get(
    "/sessions/:sessionId/audio/latest",
    async ({ params, set }) => {
      try {
        const audio = voiceAgentSessionManager.getLatestAudio(params.sessionId);
        if (!audio) {
          throw new VoiceAgentDomainError("VOICE_AGENT_AUDIO_NOT_FOUND", 404, "No synthesized audio is available yet");
        }

        return new Response(new Blob([Buffer.from(audio)], { type: "audio/wav" }), {
          headers: {
            "content-type": "audio/wav",
            "cache-control": "no-store",
          },
        });
      } catch (error) {
        return handleVoiceAgentError(set, error);
      }
    },
    {
      params: t.Object({ sessionId: t.String() }),
      response: {
        404: t.Object({ error: t.String(), message: t.String() }),
        500: t.Object({ error: t.String(), message: t.String() }),
      },
    },
  )
  .get(
    "/events",
    async ({ query, set, request }) => {
      if (!query.sessionId) {
        set.status = 400;
        return formatError("VOICE_AGENT_SESSION_ID_REQUIRED", "sessionId query param is required");
      }

      try {
        const initialSnapshot = await voiceAgentSessionManager.getSnapshot(query.sessionId);

        return new Response(
          new ReadableStream({
            start(controller) {
              const send = (type: string, data: unknown) => {
                controller.enqueue(formatSseChunk(type, data));
              };

              const unsubscribe = voiceAgentSseBroker.subscribe(query.sessionId!, (event) => {
                send(event.type, event.data);
              });

              const heartbeat = setInterval(() => {
                send("heartbeat", { timestamp: new Date().toISOString() });
              }, 15000);

              const cleanup = () => {
                clearInterval(heartbeat);
                unsubscribe();
                try {
                  controller.close();
                } catch {
                  // Stream already closed.
                }
              };

              request.signal.addEventListener("abort", cleanup, { once: true });
              send("ready", initialSnapshot);
            },
          }),
          {
            headers: {
              "cache-control": "no-cache, no-transform",
              connection: "keep-alive",
              "content-type": "text/event-stream",
            },
          },
        );
      } catch (error) {
        return handleVoiceAgentError(set, error);
      }
    },
    {
      query: t.Object({
        sessionId: t.Optional(t.String()),
      }),
      response: {
        400: t.Object({ error: t.String(), message: t.String() }),
        404: t.Object({ error: t.String(), message: t.String() }),
        500: t.Object({ error: t.String(), message: t.String() }),
      },
    },
  );
