import { logger } from "@/lib/logger";
import type {
  VoiceAgentFunctionDefinition,
  VoiceAgentToolContext,
  VoiceAgentToolExecutionResult,
  VoiceAgentToolName,
} from "@/types/voice-agent";

type ToolHandler = (context: VoiceAgentToolContext, args: Record<string, unknown>) => Promise<VoiceAgentToolExecutionResult>;

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildCandidateReplies(patientName: string, callerMessage: string) {
  const topic = callerMessage || "your message";

  return [
    {
      label: "Acknowledge",
      content: `Thank you for telling me about "${topic}". I will let ${patientName} know and stay with you on the line.`,
    },
    {
      label: "Need Clarification",
      content: `Could you please clarify a little more about "${topic}" so I can help ${patientName} respond clearly?`,
    },
    {
      label: "Call Back",
      content: `${patientName} may need a little time before replying. Can we note "${topic}" and get back to you shortly?`,
    },
    {
      label: "Supportive Reply",
      content: `I understand. I am speaking on behalf of ${patientName}, and I appreciate you explaining "${topic}" so clearly.`,
    },
  ];
}

const summarizeCallHandler: ToolHandler = async (context) => {
  const userTurns = context.turns.filter((turn) => turn.role === "user").map((turn) => turn.content);
  const assistantTurns = context.turns.filter((turn) => turn.role === "assistant").map((turn) => turn.content);
  const latestCandidateBatch = context.candidateReplies.slice(-4).map((reply) => reply.label).join(", ");

  const summary = [
    `Call summary for ${context.session.patientName}.`,
    `User turns: ${userTurns.length}.`,
    `Assistant turns: ${assistantTurns.length}.`,
    userTurns.length > 0 ? `Latest caller concern: ${userTurns[userTurns.length - 1]}.` : "No caller utterances were recorded yet.",
    latestCandidateBatch ? `Latest candidate reply labels: ${latestCandidateBatch}.` : "No candidate replies have been generated yet.",
  ].join(" ");

  return { content: summary };
};

const generateCandidateRepliesHandler: ToolHandler = async (context, args) => {
  const patientName = safeString(args.patient_name) || context.session.patientName;
  const callerMessage =
    safeString(args.caller_message)
    || context.turns.filter((turn) => turn.role === "user").slice(-1)[0]?.content
    || "the latest caller request";

  const candidateReplies = buildCandidateReplies(patientName, callerMessage);
  return {
    content: "Candidate replies have been generated for the patient UI. Wait for the client to inject the selected response before speaking.",
    candidateReplies,
  };
};

const retryAnswerHandler: ToolHandler = async (_context, args) => {
  const callerMessage = safeString(args.caller_message) || "the latest caller question";
  return {
    content: `Dummy retry answer for "${callerMessage}". Replace this tool with the real retry logic later.`,
  };
};

const kbSearchHandler: ToolHandler = async (_context, args) => {
  const query = safeString(args.query) || "general support";
  return {
    content: JSON.stringify({
      query,
      results: [
        {
          title: "Dummy Knowledge Base Result",
          snippet: `This is a dummy KB result for "${query}". Replace this with the real search integration later.`,
        },
      ],
    }),
  };
};

const toolHandlers: Record<VoiceAgentToolName, ToolHandler> = {
  summarize_call: summarizeCallHandler,
  generate_candidate_replies: generateCandidateRepliesHandler,
  retry_answer: retryAnswerHandler,
  kb_search: kbSearchHandler,
};

export const voiceAgentFunctionDefinitions: VoiceAgentFunctionDefinition[] = [
  {
    name: "summarize_call",
    description: "Summarize the current call using the saved transcript and tool history.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "generate_candidate_replies",
    description: "Generate 3-4 candidate replies for the patient to choose from.",
    parameters: {
      type: "object",
      properties: {
        caller_message: { type: "string" },
        patient_name: { type: "string" },
      },
      required: ["caller_message"],
      additionalProperties: false,
    },
  },
  {
    name: "retry_answer",
    description: "Generate a retry answer. This is a dummy implementation for now.",
    parameters: {
      type: "object",
      properties: {
        caller_message: { type: "string" },
        previous_answer: { type: "string" },
      },
      required: ["caller_message"],
      additionalProperties: false,
    },
  },
  {
    name: "kb_search",
    description: "Search a knowledge base. This is a dummy implementation for now.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

export async function runVoiceAgentTool(
  toolName: VoiceAgentToolName,
  context: VoiceAgentToolContext,
  rawArguments: string,
) {
  const handler = toolHandlers[toolName];
  const parsedArgs = rawArguments.trim() ? JSON.parse(rawArguments) as Record<string, unknown> : {};

  logger.info({ callSessionId: context.session.id, toolName, parsedArgs }, "running voice-agent tool");
  return handler(context, parsedArgs);
}
