export const VOICE_AGENT_CALL_DIRECTIONS = ["incoming", "outgoing"] as const;
export type VoiceAgentCallDirection = (typeof VOICE_AGENT_CALL_DIRECTIONS)[number];

export const VOICE_AGENT_CALL_STATES = [
  "initializing",
  "ready",
  "listening",
  "thinking",
  "speaking",
  "waiting_for_selection",
  "completed",
  "failed",
] as const;
export type VoiceAgentCallState = (typeof VOICE_AGENT_CALL_STATES)[number];

export const VOICE_AGENT_THINK_PROFILES = ["opening", "direct", "candidate", "retry"] as const;
export type VoiceAgentThinkProfile = (typeof VOICE_AGENT_THINK_PROFILES)[number];

export const VOICE_AGENT_TURN_ROLES = ["system", "user", "assistant", "tool"] as const;
export type VoiceAgentTurnRole = (typeof VOICE_AGENT_TURN_ROLES)[number];

export const VOICE_AGENT_TURN_SOURCES = [
  "system",
  "deepgram",
  "deepgram_injected",
  "ui_simulated",
  "tool_result",
  "candidate_selection",
] as const;
export type VoiceAgentTurnSource = (typeof VOICE_AGENT_TURN_SOURCES)[number];

export const VOICE_AGENT_TOOL_NAMES = [
  "summarize_call",
  "generate_candidate_replies",
  "retry_answer",
  "kb_search",
] as const;
export type VoiceAgentToolName = (typeof VOICE_AGENT_TOOL_NAMES)[number];

export const VOICE_AGENT_POST_CALL_STORAGE_MODES = ["ephemeral", "summary_only", "full"] as const;
export type VoiceAgentPostCallStorageMode = (typeof VOICE_AGENT_POST_CALL_STORAGE_MODES)[number];

export type VoiceAgentFunctionDefinition = {
  name: VoiceAgentToolName;
  description: string;
  parameters: Record<string, unknown>;
};

export type VoiceAgentCallSessionRecord = {
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
  requestId: string | null;
  summaryText: string | null;
  failureReason: string | null;
  startedAt: string;
  endedAt: string | null;
  latestTranscriptAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VoiceAgentCallTurnRecord = {
  id: string;
  callSessionId: string;
  role: VoiceAgentTurnRole;
  source: VoiceAgentTurnSource;
  content: string;
  metadataJson: string | null;
  createdAt: string;
};

export type VoiceAgentToolEventRecord = {
  id: string;
  callSessionId: string;
  functionCallId: string | null;
  toolName: VoiceAgentToolName;
  status: "requested" | "completed" | "failed";
  argumentsJson: string | null;
  responseContent: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type VoiceAgentCandidateReplyRecord = {
  id: string;
  callSessionId: string;
  batchId: string;
  ordinal: number;
  label: string;
  content: string;
  selectedAt: string | null;
  createdAt: string;
};

export type VoiceAgentSessionSnapshot = {
  session: VoiceAgentCallSessionRecord;
  turns: VoiceAgentCallTurnRecord[];
  toolEvents: VoiceAgentToolEventRecord[];
  candidateReplies: VoiceAgentCandidateReplyRecord[];
  latestAudioAvailable: boolean;
};

export type DeepgramContextMessage =
  | {
      type: "History";
      role: "user" | "assistant";
      content: string;
    }
  | {
      type: "History";
      function_calls: Array<{
        id: string;
        name: string;
        client_side: boolean;
        arguments: string;
        response?: string;
      }>;
    };

export type VoiceAgentStartSessionInput = {
  patientId: string | null;
  patientName: string;
  contactId?: string | null;
  contactName?: string | null;
  recipientTelegramUserId?: string | null;
  direction: VoiceAgentCallDirection;
  transportMode?: string;
  useMock?: boolean;
};

export type VoiceAgentToolContext = {
  session: VoiceAgentCallSessionRecord;
  turns: VoiceAgentCallTurnRecord[];
  toolEvents: VoiceAgentToolEventRecord[];
  candidateReplies: VoiceAgentCandidateReplyRecord[];
};

export type VoiceAgentToolExecutionResult = {
  content: string;
  candidateReplies?: Array<{
    label: string;
    content: string;
  }>;
};

export type DeepgramFunctionCallRequest = {
  id: string;
  name: VoiceAgentToolName;
  arguments: string;
  client_side: boolean;
};

export type VoiceAgentRuntimeEvent =
  | { type: "welcome"; requestId?: string | null }
  | { type: "settings_applied" }
  | { type: "think_updated"; profile: VoiceAgentThinkProfile }
  | { type: "conversation_text"; role: "user" | "assistant"; content: string }
  | { type: "user_started_speaking" }
  | { type: "agent_thinking"; content?: string }
  | { type: "agent_started_speaking" }
  | { type: "agent_audio"; chunk: Uint8Array }
  | { type: "agent_audio_done" }
  | { type: "function_call_request"; functions: DeepgramFunctionCallRequest[] }
  | { type: "warning"; message: string; raw?: unknown }
  | { type: "error"; message: string; raw?: unknown }
  | { type: "injection_refused" }
  | { type: "closed"; code?: number; reason?: string };

export type DeepgramAdapterConnectOptions = {
  patientName: string;
  history: DeepgramContextMessage[];
  thinkProfile: VoiceAgentThinkProfile;
};

export type VoiceAgentAdapter = {
  connect(options: DeepgramAdapterConnectOptions): Promise<void>;
  updateThinkProfile(profile: VoiceAgentThinkProfile, history: DeepgramContextMessage[]): Promise<void>;
  injectUserMessage(content: string): Promise<void>;
  injectAgentMessage(message: string): Promise<void>;
  sendFunctionCallResponse(id: string, name: VoiceAgentToolName, content: string): Promise<void>;
  close(): void;
  onEvent(listener: (event: VoiceAgentRuntimeEvent) => void): void;
};
