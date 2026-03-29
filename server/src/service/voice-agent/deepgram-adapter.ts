import { logger, serializeError } from "@/lib/logger";
import type {
  DeepgramAdapterConnectOptions,
  DeepgramContextMessage,
  VoiceAgentAdapter,
  VoiceAgentFunctionDefinition,
  VoiceAgentRuntimeEvent,
  VoiceAgentThinkProfile,
  VoiceAgentToolName,
} from "@/types/voice-agent";
import { resolveGreeting, voiceAgentConfig } from "./config";

type Listener = (event: VoiceAgentRuntimeEvent) => void;

function emitToListeners(listeners: Set<Listener>, event: VoiceAgentRuntimeEvent) {
  for (const listener of listeners) {
    listener(event);
  }
}

function toProviderTemperature(profile: VoiceAgentThinkProfile) {
  return voiceAgentConfig.temperatures[profile];
}

function buildThinkSettings(profile: VoiceAgentThinkProfile, history: DeepgramContextMessage[]) {
  return {
    provider: {
      type: voiceAgentConfig.thinkProvider,
      model: voiceAgentConfig.thinkModel,
      temperature: toProviderTemperature(profile),
    },
    endpoint: {
      type: "function",
    },
    functions: [] as VoiceAgentFunctionDefinition[],
    prompt: "",
    context: {
      messages: history,
    },
  };
}

function normalizeBinaryPayload(data: Blob | ArrayBuffer | Uint8Array | string) {
  if (typeof data === "string") return null;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  return data.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

export class DeepgramVoiceAgentAdapter implements VoiceAgentAdapter {
  private readonly listeners = new Set<Listener>();
  private readonly functionDefinitions: VoiceAgentFunctionDefinition[];
  private socket: WebSocket | null = null;

  constructor(functionDefinitions: VoiceAgentFunctionDefinition[]) {
    this.functionDefinitions = functionDefinitions;
  }

  onEvent(listener: Listener) {
    this.listeners.add(listener);
  }

  async connect(options: DeepgramAdapterConnectOptions) {
    if (!voiceAgentConfig.apiKey) {
      throw new Error("DEEPGRAM_API_KEY is not configured");
    }

    const url = new URL(voiceAgentConfig.socketUrl);
    url.searchParams.set("token", voiceAgentConfig.apiKey);

    this.socket = new WebSocket(url.toString());
    this.socket.binaryType = "arraybuffer";

    this.socket.addEventListener("message", (event) => {
      void this.handleMessage(event.data);
    });

    this.socket.addEventListener("close", (event) => {
      emitToListeners(this.listeners, {
        type: "closed",
        code: event.code,
        reason: event.reason,
      });
    });

    this.socket.addEventListener("error", (event) => {
      emitToListeners(this.listeners, {
        type: "error",
        message: "Deepgram websocket error",
        raw: event,
      });
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out connecting to Deepgram Voice Agent")), 10000);
      this.socket!.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      this.socket!.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          reject(new Error("Failed to connect to Deepgram Voice Agent"));
        },
        { once: true },
      );
    });

    this.sendJson({
      type: "Settings",
      audio: {
        input: {
          encoding: voiceAgentConfig.inputEncoding,
          sample_rate: voiceAgentConfig.inputSampleRate,
        },
        output: {
          encoding: voiceAgentConfig.outputEncoding,
          sample_rate: voiceAgentConfig.outputSampleRate,
          container: "none",
        },
      },
      agent: {
        greeting: resolveGreeting(options.patientName),
        language: voiceAgentConfig.defaultLanguage,
        listen: {
          provider: {
            type: "deepgram",
            model: voiceAgentConfig.listenModel,
            version: voiceAgentConfig.listenVersion,
          },
        },
        think: {
          ...buildThinkSettings(options.thinkProfile, options.history),
          functions: this.functionDefinitions,
          prompt: [
            `You are the GazeConnect Bot speaking on behalf of ${options.patientName}.`,
            "Keep answers concise and conversational for a live phone call.",
            "If the caller asks for patient-specific intent or a sensitive response, prefer the generate_candidate_replies tool.",
            "If knowledge retrieval is needed, call kb_search before answering.",
            "Only use retry_answer when the client explicitly asks for a retry.",
          ].join(" "),
        },
        speak: {
          provider: {
            type: "deepgram",
            model: voiceAgentConfig.speakModel,
          },
        },
        context: {
          messages: options.history,
        },
      },
    });
  }

  async updateThinkProfile(profile: VoiceAgentThinkProfile, history: DeepgramContextMessage[]) {
    this.sendJson({
      type: "UpdateThink",
      think: {
        ...buildThinkSettings(profile, history),
        functions: this.functionDefinitions,
      },
    });

    emitToListeners(this.listeners, {
      type: "think_updated",
      profile,
    });
  }

  async injectUserMessage(content: string) {
    this.sendJson({
      type: "InjectUserMessage",
      message: content,
    });
  }

  async injectAgentMessage(message: string) {
    this.sendJson({
      type: "InjectAgentMessage",
      message,
    });
  }

  async sendFunctionCallResponse(id: string, name: VoiceAgentToolName, content: string) {
    this.sendJson({
      type: "FunctionCallResponse",
      id,
      name,
      content,
    });
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }

  private sendJson(payload: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Deepgram Voice Agent socket is not open");
    }

    this.socket.send(JSON.stringify(payload));
  }

  private async handleMessage(raw: Blob | ArrayBuffer | Uint8Array | string) {
    try {
      const maybeBinary = await normalizeBinaryPayload(raw);
      if (maybeBinary) {
        emitToListeners(this.listeners, {
          type: "agent_audio",
          chunk: maybeBinary,
        });
        return;
      }

      if (typeof raw !== "string") {
        throw new Error("Expected a JSON text payload from Deepgram");
      }

      const payload = JSON.parse(raw);
      const payloadType = typeof payload.type === "string" ? payload.type : "Unknown";

      switch (payloadType) {
        case "Welcome":
          emitToListeners(this.listeners, {
            type: "welcome",
            requestId: typeof payload.request_id === "string" ? payload.request_id : null,
          });
          break;
        case "SettingsApplied":
          emitToListeners(this.listeners, { type: "settings_applied" });
          break;
        case "ConversationText":
          emitToListeners(this.listeners, {
            type: "conversation_text",
            role: payload.role === "assistant" ? "assistant" : "user",
            content: typeof payload.content === "string" ? payload.content : "",
          });
          break;
        case "UserStartedSpeaking":
          emitToListeners(this.listeners, { type: "user_started_speaking" });
          break;
        case "AgentThinking":
          emitToListeners(this.listeners, {
            type: "agent_thinking",
            content: typeof payload.content === "string" ? payload.content : undefined,
          });
          break;
        case "AgentStartedSpeaking":
          emitToListeners(this.listeners, { type: "agent_started_speaking" });
          break;
        case "AgentAudioDone":
          emitToListeners(this.listeners, { type: "agent_audio_done" });
          break;
        case "FunctionCallRequest":
          emitToListeners(this.listeners, {
            type: "function_call_request",
            functions: Array.isArray(payload.functions)
              ? payload.functions.map((entry: Record<string, unknown>) => ({
                  id: String(entry.id ?? crypto.randomUUID()),
                  name: String(entry.name) as VoiceAgentToolName,
                  arguments: typeof entry.arguments === "string" ? entry.arguments : JSON.stringify(entry.arguments ?? {}),
                  client_side: Boolean(entry.client_side),
                }))
              : [],
          });
          break;
        case "AgentWarnings":
          emitToListeners(this.listeners, {
            type: "warning",
            message: typeof payload.message === "string" ? payload.message : "Deepgram warning",
            raw: payload,
          });
          break;
        case "AgentErrors":
          emitToListeners(this.listeners, {
            type: "error",
            message: typeof payload.message === "string" ? payload.message : "Deepgram agent error",
            raw: payload,
          });
          break;
        case "InjectionRefused":
          emitToListeners(this.listeners, { type: "injection_refused" });
          break;
        default:
          emitToListeners(this.listeners, {
            type: "warning",
            message: `Unhandled Deepgram event: ${payloadType}`,
            raw: payload,
          });
      }
    } catch (error) {
      logger.error({ error: serializeError(error) }, "failed to handle Deepgram Voice Agent message");
      emitToListeners(this.listeners, {
        type: "error",
        message: "Failed to process a Deepgram Voice Agent message",
        raw: error,
      });
    }
  }
}
