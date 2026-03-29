import type {
  DeepgramAdapterConnectOptions,
  VoiceAgentAdapter,
  VoiceAgentRuntimeEvent,
  VoiceAgentThinkProfile,
  VoiceAgentToolName,
} from "@/types/voice-agent";
import { createTonePcm } from "./audio";
import { resolveGreeting, voiceAgentConfig } from "./config";

type Listener = (event: VoiceAgentRuntimeEvent) => void;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emit(listeners: Set<Listener>, event: VoiceAgentRuntimeEvent) {
  for (const listener of listeners) {
    listener(event);
  }
}

export class MockVoiceAgentAdapter implements VoiceAgentAdapter {
  private readonly listeners = new Set<Listener>();

  onEvent(listener: Listener) {
    this.listeners.add(listener);
  }

  async connect(options: DeepgramAdapterConnectOptions) {
    emit(this.listeners, { type: "welcome", requestId: "mock-request" });
    await wait(50);
    emit(this.listeners, { type: "settings_applied" });
    await this.playAssistantMessage(resolveGreeting(options.patientName));
  }

  async updateThinkProfile(profile: VoiceAgentThinkProfile) {
    emit(this.listeners, { type: "think_updated", profile });
  }

  async injectUserMessage(content: string) {
    emit(this.listeners, { type: "user_started_speaking" });
    await wait(40);
    emit(this.listeners, {
      type: "conversation_text",
      role: "user",
      content,
    });
    await wait(100);
    emit(this.listeners, { type: "agent_thinking", content: "Mock adapter thinking" });

    const normalized = content.toLowerCase();
    if (normalized.includes("knowledge") || normalized.includes("faq") || normalized.includes("medicine")) {
      emit(this.listeners, {
        type: "function_call_request",
        functions: [
          {
            id: crypto.randomUUID(),
            name: "kb_search",
            arguments: JSON.stringify({ query: content }),
            client_side: true,
          },
        ],
      });
      return;
    }

    if (normalized.includes("patient") || normalized.includes("ask") || normalized.includes("approval")) {
      emit(this.listeners, {
        type: "function_call_request",
        functions: [
          {
            id: crypto.randomUUID(),
            name: "generate_candidate_replies",
            arguments: JSON.stringify({ caller_message: content }),
            client_side: true,
          },
        ],
      });
      return;
    }

    await this.playAssistantMessage(`Mock direct answer: I heard "${content}" and I can respond directly for now.`);
  }

  async injectAgentMessage(message: string) {
    await this.playAssistantMessage(message);
  }

  async sendFunctionCallResponse(id: string, name: VoiceAgentToolName, content: string) {
    emit(this.listeners, {
      type: "warning",
      message: `Mock tool response received for ${name} (${id})`,
      raw: content,
    });
    await this.playAssistantMessage(`Tool ${name} completed. ${content}`);
  }

  close() {
    emit(this.listeners, { type: "closed", code: 1000, reason: "mock adapter closed" });
  }

  private async playAssistantMessage(message: string) {
    emit(this.listeners, {
      type: "conversation_text",
      role: "assistant",
      content: message,
    });
    emit(this.listeners, { type: "agent_started_speaking" });

    const tone = createTonePcm(voiceAgentConfig.outputSampleRate, 600, 523);
    emit(this.listeners, {
      type: "agent_audio",
      chunk: tone,
    });
    await wait(150);
    emit(this.listeners, { type: "agent_audio_done" });
  }
}
