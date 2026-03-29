import { logger, serializeError } from "@/lib/logger";
import type {
  DeepgramContextMessage,
  VoiceAgentAdapter,
  VoiceAgentCallSessionRecord,
  VoiceAgentCallTurnRecord,
  VoiceAgentCandidateReplyRecord,
  VoiceAgentRuntimeEvent,
  VoiceAgentSessionSnapshot,
  VoiceAgentStartSessionInput,
  VoiceAgentThinkProfile,
  VoiceAgentToolContext,
  VoiceAgentToolEventRecord,
  VoiceAgentToolName,
} from "@/types/voice-agent";
import { concatChunks, pcmToWav } from "./audio";
import { voiceAgentConfig } from "./config";
import { DeepgramVoiceAgentAdapter } from "./deepgram-adapter";
import { VoiceAgentDomainError } from "./errors";
import { MockVoiceAgentAdapter } from "./mock-adapter";
import { voiceAgentRepository } from "./repository";
import { voiceAgentSseBroker } from "./sse-broker";
import { runVoiceAgentTool, voiceAgentFunctionDefinitions } from "./tools";

type SessionHistoryStore = {
  turns: VoiceAgentCallTurnRecord[];
  toolEvents: VoiceAgentToolEventRecord[];
  candidateReplies: VoiceAgentCandidateReplyRecord[];
};

type RuntimeState = SessionHistoryStore & {
  adapter: VoiceAgentAdapter;
  latestAudioWav: Uint8Array | null;
  pendingPcmChunks: Uint8Array[];
  useMock: boolean;
  lastThinkProfile: VoiceAgentThinkProfile;
  isEnding: boolean;
};

type EndedSnapshotState = SessionHistoryStore & {
  latestAudioWav: Uint8Array | null;
  expiresAtEpochMs: number | null;
};

function toContextHistory(snapshot: VoiceAgentSessionSnapshot): DeepgramContextMessage[] {
  const messages: DeepgramContextMessage[] = [];

  for (const turn of snapshot.turns.slice(-20)) {
    if (turn.role === "user" || turn.role === "assistant") {
      messages.push({
        type: "History",
        role: turn.role,
        content: turn.content,
      });
    }
  }

  for (const toolEvent of snapshot.toolEvents.slice(-10)) {
    if (toolEvent.status !== "completed" || !toolEvent.functionCallId || !toolEvent.responseContent) continue;

    messages.push({
      type: "History",
      function_calls: [
        {
          id: toolEvent.functionCallId,
          name: toolEvent.toolName,
          client_side: true,
          arguments: toolEvent.argumentsJson ?? "{}",
          response: toolEvent.responseContent,
        },
      ],
    });
  }

  return messages;
}

function toToolContext(snapshot: VoiceAgentSessionSnapshot): VoiceAgentToolContext {
  return {
    session: snapshot.session,
    turns: snapshot.turns,
    toolEvents: snapshot.toolEvents,
    candidateReplies: snapshot.candidateReplies,
  };
}

function cloneHistory(store: SessionHistoryStore): SessionHistoryStore {
  return {
    turns: [...store.turns],
    toolEvents: [...store.toolEvents],
    candidateReplies: [...store.candidateReplies],
  };
}

export class VoiceAgentSessionManager {
  private readonly runtimes = new Map<string, RuntimeState>();
  private readonly endedSnapshots = new Map<string, EndedSnapshotState>();

  async startSession(input: VoiceAgentStartSessionInput) {
    this.purgeExpiredEndedSnapshots();
    const useMock = (input.useMock ?? voiceAgentConfig.defaultUseMock) || !voiceAgentConfig.apiKey;
    const session = await voiceAgentRepository.createSession({
      id: crypto.randomUUID(),
      patientId: input.patientId,
      patientName: input.patientName,
      contactId: input.contactId ?? null,
      contactName: input.contactName ?? null,
      recipientTelegramUserId: input.recipientTelegramUserId ?? null,
      direction: input.direction,
      state: "initializing",
      thinkProfile: "opening",
      transportMode: input.transportMode ?? voiceAgentConfig.defaultTransportMode,
    });

    const adapter = useMock ? new MockVoiceAgentAdapter() : new DeepgramVoiceAgentAdapter(voiceAgentFunctionDefinitions);

    const runtime: RuntimeState = {
      adapter,
      latestAudioWav: null,
      pendingPcmChunks: [],
      useMock,
      lastThinkProfile: "opening",
      turns: [],
      toolEvents: [],
      candidateReplies: [],
      isEnding: false,
    };

    this.runtimes.set(session.id, runtime);
    this.attachRuntimeListeners(session, runtime);

    await adapter.connect({
      patientName: session.patientName,
      history: [],
      thinkProfile: "opening",
    });

    return this.getSnapshot(session.id);
  }

  async getSnapshot(sessionId: string) {
    this.purgeExpiredEndedSnapshots();
    const session = await voiceAgentRepository.getSession(sessionId);
    if (!session) {
      throw new VoiceAgentDomainError("VOICE_AGENT_SESSION_NOT_FOUND", 404, "Voice agent session not found");
    }

    const runtime = this.runtimes.get(sessionId);
    if (runtime) {
      return this.buildSnapshot(session, runtime, Boolean(runtime.latestAudioWav));
    }

    const endedSnapshot = this.endedSnapshots.get(sessionId);
    if (endedSnapshot) {
      return this.buildSnapshot(session, endedSnapshot, Boolean(endedSnapshot.latestAudioWav));
    }

    return this.buildSnapshot(
      session,
      {
        turns: [],
        toolEvents: [],
        candidateReplies: [],
      },
      false,
    );
  }

  getLatestAudio(sessionId: string) {
    const runtimeAudio = this.runtimes.get(sessionId)?.latestAudioWav;
    if (runtimeAudio) return runtimeAudio;

    return this.endedSnapshots.get(sessionId)?.latestAudioWav ?? null;
  }

  async simulateUserTurn(sessionId: string, text: string) {
    const runtime = this.getRuntime(sessionId);
    await this.ensureThinkProfile(sessionId, "direct");
    await runtime.adapter.injectUserMessage(text);
    return this.getSnapshot(sessionId);
  }

  async selectCandidateReply(sessionId: string, candidateId: string) {
    const runtime = this.getRuntime(sessionId);
    const candidate = runtime.candidateReplies.find((entry) => entry.id === candidateId);
    if (!candidate) {
      throw new VoiceAgentDomainError("VOICE_AGENT_CANDIDATE_NOT_FOUND", 404, "Candidate reply not found");
    }

    candidate.selectedAt = new Date().toISOString();
    await this.appendTurn(sessionId, runtime, {
      role: "assistant",
      source: "candidate_selection",
      content: candidate.content,
      metadataJson: JSON.stringify({ candidateId }),
    });

    await this.ensureThinkProfile(sessionId, "direct");
    await runtime.adapter.injectAgentMessage(candidate.content);
    await voiceAgentRepository.updateSession(sessionId, {
      state: "speaking",
    });
    voiceAgentSseBroker.publish(sessionId, "candidate_selected", { candidateId, content: candidate.content });
    return this.getSnapshot(sessionId);
  }

  async retryAnswer(sessionId: string) {
    const runtime = this.getRuntime(sessionId);
    const snapshot = await this.getSnapshot(sessionId);
    const latestUserTurn = snapshot.turns.filter((turn) => turn.role === "user").slice(-1)[0];
    const rawArguments = JSON.stringify({
      caller_message: latestUserTurn?.content ?? "the latest caller message",
      previous_answer: snapshot.turns.filter((turn) => turn.role === "assistant").slice(-1)[0]?.content ?? "",
    });

    await this.appendToolEvent(sessionId, runtime, {
      toolName: "retry_answer",
      status: "requested",
      argumentsJson: rawArguments,
    });

    const result = await runVoiceAgentTool("retry_answer", toToolContext(snapshot), rawArguments);
    await this.appendToolEvent(sessionId, runtime, {
      toolName: "retry_answer",
      status: "completed",
      argumentsJson: rawArguments,
      responseContent: result.content,
    });

    await this.ensureThinkProfile(sessionId, "retry");
    await runtime.adapter.injectAgentMessage(result.content);
    voiceAgentSseBroker.publish(sessionId, "retry_completed", { content: result.content });
    return this.getSnapshot(sessionId);
  }

  async summarizeCall(sessionId: string) {
    const runtime = this.getRuntime(sessionId);
    const snapshot = await this.getSnapshot(sessionId);
    const result = await runVoiceAgentTool("summarize_call", toToolContext(snapshot), "{}");

    await this.appendToolEvent(sessionId, runtime, {
      toolName: "summarize_call",
      status: "completed",
      argumentsJson: "{}",
      responseContent: result.content,
    });

    await voiceAgentRepository.updateSession(sessionId, {
      summaryText: result.content,
    });
    voiceAgentSseBroker.publish(sessionId, "summary_updated", { summary: result.content });
    return this.getSnapshot(sessionId);
  }

  async endSession(sessionId: string) {
    const runtime = this.runtimes.get(sessionId);
    if (runtime) {
      runtime.isEnding = true;
      runtime.adapter.close();
      this.captureEndedSnapshot(sessionId, runtime);
      this.runtimes.delete(sessionId);
    }

    const shouldDropPostCallData = voiceAgentConfig.postCallStorageMode === "ephemeral";
    const sessionUpdate: Parameters<typeof voiceAgentRepository.updateSession>[1] = {
      state: "completed",
      endedAt: new Date(),
    };
    if (shouldDropPostCallData) {
      sessionUpdate.summaryText = null;
      sessionUpdate.latestTranscriptAt = null;
    }

    const updatedSession = await voiceAgentRepository.updateSession(sessionId, sessionUpdate);

    if (!updatedSession) {
      throw new VoiceAgentDomainError("VOICE_AGENT_SESSION_NOT_FOUND", 404, "Voice agent session not found");
    }

    voiceAgentSseBroker.publish(sessionId, "session_ended", { sessionId });
    return this.getSnapshot(sessionId);
  }

  private buildSnapshot(
    session: VoiceAgentCallSessionRecord,
    store: SessionHistoryStore,
    latestAudioAvailable: boolean,
  ): VoiceAgentSessionSnapshot {
    const history = cloneHistory(store);
    return {
      session,
      turns: history.turns,
      toolEvents: history.toolEvents,
      candidateReplies: history.candidateReplies,
      latestAudioAvailable,
    };
  }

  private getRuntime(sessionId: string) {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      throw new VoiceAgentDomainError("VOICE_AGENT_RUNTIME_NOT_FOUND", 404, "Voice agent runtime is not active");
    }

    return runtime;
  }

  private async ensureThinkProfile(sessionId: string, profile: VoiceAgentThinkProfile) {
    const runtime = this.getRuntime(sessionId);
    if (runtime.lastThinkProfile === profile) return;

    const snapshot = await this.getSnapshot(sessionId);
    await runtime.adapter.updateThinkProfile(profile, toContextHistory(snapshot));
    runtime.lastThinkProfile = profile;
    await voiceAgentRepository.updateSession(sessionId, {
      thinkProfile: profile,
    });
  }

  private attachRuntimeListeners(session: VoiceAgentCallSessionRecord, runtime: RuntimeState) {
    runtime.adapter.onEvent((event) => {
      void this.handleRuntimeEvent(session.id, event).catch((error) => {
        logger.error(
          {
            callSessionId: session.id,
            error: serializeError(error),
          },
          "voice-agent runtime event handling failed",
        );
      });
    });
  }

  private async appendTurn(
    sessionId: string,
    runtime: RuntimeState,
    input: {
      role: VoiceAgentCallTurnRecord["role"];
      source: VoiceAgentCallTurnRecord["source"];
      content: string;
      metadataJson?: string | null;
    },
  ) {
    runtime.turns.push({
      id: crypto.randomUUID(),
      callSessionId: sessionId,
      role: input.role,
      source: input.source,
      content: input.content,
      metadataJson: input.metadataJson ?? null,
      createdAt: new Date().toISOString(),
    });
    await voiceAgentRepository.updateSession(sessionId, {
      latestTranscriptAt: new Date(),
    });
  }

  private async appendToolEvent(
    sessionId: string,
    runtime: RuntimeState,
    input: {
      functionCallId?: string | null;
      toolName: VoiceAgentToolName;
      status: "requested" | "completed" | "failed";
      argumentsJson?: string | null;
      responseContent?: string | null;
      errorMessage?: string | null;
    },
  ) {
    runtime.toolEvents.push({
      id: crypto.randomUUID(),
      callSessionId: sessionId,
      functionCallId: input.functionCallId ?? null,
      toolName: input.toolName,
      status: input.status,
      argumentsJson: input.argumentsJson ?? null,
      responseContent: input.responseContent ?? null,
      errorMessage: input.errorMessage ?? null,
      createdAt: new Date().toISOString(),
    });
  }

  private addCandidateReplies(sessionId: string, runtime: RuntimeState, replies: Array<{ label: string; content: string }>) {
    if (replies.length === 0) return;
    const batchId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    runtime.candidateReplies = replies.map((reply, index) => ({
      id: crypto.randomUUID(),
      callSessionId: sessionId,
      batchId,
      ordinal: index + 1,
      label: reply.label,
      content: reply.content,
      selectedAt: null,
      createdAt,
    }));
  }

  private captureEndedSnapshot(sessionId: string, runtime: RuntimeState) {
    if (voiceAgentConfig.postCallStorageMode === "summary_only" || voiceAgentConfig.postCallStorageMode === "ephemeral") {
      this.endedSnapshots.delete(sessionId);
      return;
    }

    const expiresAtEpochMs = Date.now() + voiceAgentConfig.endedSessionTtlSeconds * 1000;
    this.endedSnapshots.set(sessionId, {
      turns: [...runtime.turns],
      toolEvents: [...runtime.toolEvents],
      candidateReplies: [...runtime.candidateReplies],
      latestAudioWav: runtime.latestAudioWav,
      expiresAtEpochMs,
    });
  }

  private purgeExpiredEndedSnapshots() {
    const now = Date.now();
    for (const [sessionId, snapshot] of this.endedSnapshots) {
      if (snapshot.expiresAtEpochMs !== null && snapshot.expiresAtEpochMs <= now) {
        this.endedSnapshots.delete(sessionId);
      }
    }
  }

  private async handleRuntimeEvent(sessionId: string, event: VoiceAgentRuntimeEvent) {
    const runtime = this.runtimes.get(sessionId);

    switch (event.type) {
      case "welcome":
        await voiceAgentRepository.updateSession(sessionId, {
          requestId: event.requestId ?? null,
        });
        break;
      case "settings_applied":
        await voiceAgentRepository.updateSession(sessionId, {
          state: "ready",
        });
        break;
      case "think_updated":
        if (runtime) {
          runtime.lastThinkProfile = event.profile;
        }
        await voiceAgentRepository.updateSession(sessionId, {
          thinkProfile: event.profile,
        });
        break;
      case "user_started_speaking":
        await voiceAgentRepository.updateSession(sessionId, {
          state: "listening",
        });
        break;
      case "agent_thinking":
        await voiceAgentRepository.updateSession(sessionId, {
          state: "thinking",
        });
        break;
      case "agent_started_speaking":
        if (runtime) {
          runtime.pendingPcmChunks = [];
        }
        await voiceAgentRepository.updateSession(sessionId, {
          state: "speaking",
        });
        break;
      case "agent_audio":
        runtime?.pendingPcmChunks.push(event.chunk);
        break;
      case "agent_audio_done":
        if (runtime) {
          runtime.latestAudioWav = pcmToWav(concatChunks(runtime.pendingPcmChunks), voiceAgentConfig.outputSampleRate);
          runtime.pendingPcmChunks = [];
          voiceAgentSseBroker.publish(sessionId, "audio_ready", { available: true });
        }
        break;
      case "conversation_text":
        if (runtime) {
          await this.appendTurn(sessionId, runtime, {
            role: event.role,
            source: runtime.useMock ? "ui_simulated" : "deepgram",
            content: event.content,
          });
        }
        break;
      case "function_call_request":
        await this.handleFunctionRequests(sessionId, event.functions);
        break;
      case "warning":
        logger.warn({ callSessionId: sessionId, warning: event.message, raw: event.raw }, "voice-agent warning");
        break;
      case "error":
        await voiceAgentRepository.updateSession(sessionId, {
          state: "failed",
          failureReason: event.message,
        });
        logger.error({ callSessionId: sessionId, error: event.message, raw: event.raw }, "voice-agent error");
        break;
      case "injection_refused":
        logger.warn({ callSessionId: sessionId }, "voice-agent injection refused");
        break;
      case "closed":
        logger.info({ callSessionId: sessionId, code: event.code, reason: event.reason }, "voice-agent closed");
        break;
    }

    voiceAgentSseBroker.publish(sessionId, event.type, event);
  }

  private async handleFunctionRequests(
    sessionId: string,
    functions: Array<{ id: string; name: VoiceAgentToolName; arguments: string; client_side: boolean }>,
  ) {
    if (functions.length === 0) return;

    const runtime = this.getRuntime(sessionId);

    for (const fn of functions) {
      await this.appendToolEvent(sessionId, runtime, {
        functionCallId: fn.id,
        toolName: fn.name,
        status: "requested",
        argumentsJson: fn.arguments,
      });

      try {
        const snapshot = await this.getSnapshot(sessionId);
        const result = await runVoiceAgentTool(fn.name, toToolContext(snapshot), fn.arguments);

        if (fn.name === "generate_candidate_replies" && result.candidateReplies?.length) {
          this.addCandidateReplies(sessionId, runtime, result.candidateReplies);
          await voiceAgentRepository.updateSession(sessionId, {
            state: "waiting_for_selection",
          });
          voiceAgentSseBroker.publish(sessionId, "candidate_replies_generated", {
            count: result.candidateReplies.length,
          });
        }

        if (fn.name === "summarize_call") {
          await voiceAgentRepository.updateSession(sessionId, {
            summaryText: result.content,
          });
        }

        await this.appendToolEvent(sessionId, runtime, {
          functionCallId: fn.id,
          toolName: fn.name,
          status: "completed",
          argumentsJson: fn.arguments,
          responseContent: result.content,
        });

        await runtime.adapter.sendFunctionCallResponse(fn.id, fn.name, result.content);
      } catch (error) {
        await this.appendToolEvent(sessionId, runtime, {
          functionCallId: fn.id,
          toolName: fn.name,
          status: "failed",
          argumentsJson: fn.arguments,
          errorMessage: error instanceof Error ? error.message : "Unknown tool error",
        });
        logger.error({ callSessionId: sessionId, toolName: fn.name, error: serializeError(error) }, "voice-agent tool failed");
      }
    }
  }
}

export const voiceAgentSessionManager = new VoiceAgentSessionManager();
