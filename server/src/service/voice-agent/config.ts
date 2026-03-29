import type { VoiceAgentPostCallStorageMode, VoiceAgentThinkProfile } from "@/types/voice-agent";

type VoiceAgentConfig = {
  apiKey: string | null;
  socketUrl: string;
  listenModel: string;
  listenVersion: string;
  thinkProvider: string;
  thinkModel: string;
  speakModel: string;
  inputEncoding: "linear16";
  inputSampleRate: number;
  outputEncoding: "linear16";
  outputSampleRate: number;
  defaultLanguage: string;
  defaultTransportMode: string;
  postCallStorageMode: VoiceAgentPostCallStorageMode;
  endedSessionTtlSeconds: number;
  greetingTemplate: string;
  defaultUseMock: boolean;
  temperatures: Record<VoiceAgentThinkProfile, number>;
};

function parseInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTemperature(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
}

function parseStorageMode(value: string | undefined): VoiceAgentPostCallStorageMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "ephemeral" || normalized === "summary_only" || normalized === "full") {
    return normalized;
  }

  return "summary_only";
}

export const voiceAgentConfig: VoiceAgentConfig = {
  apiKey: process.env.DEEPGRAM_API_KEY?.trim() || null,
  socketUrl: process.env.DEEPGRAM_VOICE_AGENT_URL?.trim() || "wss://agent.deepgram.com/v1/agent/converse",
  listenModel: process.env.DEEPGRAM_AGENT_LISTEN_MODEL?.trim() || "flux-general-en",
  listenVersion: process.env.DEEPGRAM_AGENT_LISTEN_VERSION?.trim() || "latest",
  thinkProvider: process.env.DEEPGRAM_AGENT_THINK_PROVIDER?.trim() || "open_ai",
  thinkModel: process.env.DEEPGRAM_AGENT_THINK_MODEL?.trim() || "gpt-4o-mini",
  speakModel: process.env.DEEPGRAM_AGENT_SPEAK_MODEL?.trim() || "aura-2-thalia-en",
  inputEncoding: "linear16",
  inputSampleRate: parseInteger(process.env.DEEPGRAM_AGENT_INPUT_SAMPLE_RATE, 16000),
  outputEncoding: "linear16",
  outputSampleRate: parseInteger(process.env.DEEPGRAM_AGENT_OUTPUT_SAMPLE_RATE, 24000),
  defaultLanguage: process.env.DEEPGRAM_AGENT_LANGUAGE?.trim() || "en",
  defaultTransportMode: process.env.VOICE_AGENT_TRANSPORT_MODE?.trim() || "debug",
  postCallStorageMode: parseStorageMode(process.env.VOICE_AGENT_POST_CALL_STORAGE_MODE),
  endedSessionTtlSeconds: parseInteger(process.env.VOICE_AGENT_ENDED_SESSION_TTL_SECONDS, 900),
  greetingTemplate:
    process.env.DEEPGRAM_AGENT_GREETING_TEMPLATE?.trim()
    || "Hi, I am the GazeConnect Bot. I am talking on behalf of {{patientName}}. What would you like to talk to {{patientName}} about?",
  defaultUseMock: parseBoolean(process.env.DEEPGRAM_AGENT_USE_MOCK_DEFAULT, false),
  temperatures: {
    opening: parseTemperature(process.env.DEEPGRAM_AGENT_TEMP_OPENING, 0.2),
    direct: parseTemperature(process.env.DEEPGRAM_AGENT_TEMP_DIRECT, 0.2),
    candidate: parseTemperature(process.env.DEEPGRAM_AGENT_TEMP_CANDIDATE, 0.7),
    retry: parseTemperature(process.env.DEEPGRAM_AGENT_TEMP_RETRY, 0.5),
  },
};

export function resolveGreeting(patientName: string) {
  return voiceAgentConfig.greetingTemplate.replaceAll("{{patientName}}", patientName);
}
