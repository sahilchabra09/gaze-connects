import { AIService } from "@/service/AI/AIService";
import { contactService } from "./contact-service";
import { TelegramDomainError } from "./errors";
import { telegramClientManager } from "./tdlib";
import type { ChatMessage, ReplyOption } from "./types";

const TELEGRAM_REPLY_LIMIT = 3;
const TELEGRAM_HISTORY_LIMIT = 20;
const TELEGRAM_KB_FOCUS_LIMIT = 5;

type TelegramReplyGenerationOutput = {
  replies: Array<{
    text: string;
  }>;
};

function getSortedMessages(messages: ChatMessage[]) {
  return [...messages]
    .sort((left, right) => Date.parse(left.sentAt) - Date.parse(right.sentAt))
    .slice(-TELEGRAM_HISTORY_LIMIT);
}

function toTranscript(messages: ChatMessage[], contactName: string) {
  return getSortedMessages(messages)
    .map((message, index) => {
      const speaker = message.direction === "incoming" ? contactName : "Patient";
      const content = message.text.trim() || `[${message.contentType}]`;
      return `${index + 1}. ${speaker}: ${content}`;
    })
    .join("\n");
}

function getRecentIncomingTexts(messages: ChatMessage[]) {
  return getSortedMessages(messages)
    .filter((message) => message.direction === "incoming")
    .map((message) => message.text.trim())
    .filter(Boolean)
    .slice(-TELEGRAM_KB_FOCUS_LIMIT);
}

function buildKnowledgeBaseQuery(messages: ChatMessage[], contact: { name: string; relation: string; role: string; notes?: string | null }) {
  const recentIncomingTexts = getRecentIncomingTexts(messages);
  const latestIncomingText = recentIncomingTexts[recentIncomingTexts.length - 1] ?? "No recent incoming question was found.";
  const relatedQuestions = recentIncomingTexts.length
    ? recentIncomingTexts.map((text, index) => `${index + 1}. ${text}`).join("\n")
    : "No recent incoming questions were found.";

  return `Fetch knowledge base chunks needed to answer the latest Telegram question directly.

Latest incoming question to answer:
${latestIncomingText}

Recent related incoming questions for subject resolution:
${relatedQuestions}

Search guidance:
- Identify the person, profile, or entity referenced by the latest and related questions.
- If the latest question omits the name, use the earlier related questions to infer the subject.
- Prioritize chunks that directly answer the latest question.
- Prioritize biography, profile, self-description, education, experience, background, role, and relationship details when relevant.
- Return the most relevant chunks only.

Chat metadata:
- Contact name: ${contact.name}
- Contact relation: ${contact.relation}
- Contact role: ${contact.role}
${contact.notes ? `- Contact notes: ${contact.notes}` : ""}`;
}

function toReplyLabel(text: string) {
  return text.length <= 42 ? text : `${text.slice(0, 39).trimEnd()}...`;
}

function normalizeReplies(replies: Array<{ text: string }>): ReplyOption[] {
  const seen = new Set<string>();
  const normalized: ReplyOption[] = [];

  for (const reply of replies) {
    const text = reply.text.replace(/\s+/g, " ").trim().slice(0, 280);

    if (!text || isLowConfidenceReply(text)) {
      continue;
    }

    const dedupeKey = text.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push({
      id: crypto.randomUUID(),
      label: toReplyLabel(text),
      text,
      source: "ai-telegram",
    });

    if (normalized.length >= TELEGRAM_REPLY_LIMIT) {
      break;
    }
  }

  return normalized;
}

function isLowConfidenceReply(text: string) {
  const normalized = text.toLowerCase();
  return [
    "i don't have that info",
    "i dont have that info",
    "i don't know",
    "i dont know",
    "let me look it up",
    "get back to you",
    "sorry, i don't know",
  ].some((pattern) => normalized.includes(pattern));
}

class TelegramAiReplyService {
  async list(patientId: string, chatId: string): Promise<ReplyOption[]> {
    const contact = await contactService.getActiveByChatId(patientId, chatId);
    const openChat = await telegramClientManager.openChat(patientId, contact.id);
    const recentMessages = openChat.messages.slice(-TELEGRAM_HISTORY_LIMIT);
    const transcript = toTranscript(recentMessages, openChat.contact.name);
    const recentIncomingTexts = getRecentIncomingTexts(recentMessages);
    const latestIncomingText = recentIncomingTexts[recentIncomingTexts.length - 1] ?? "No recent incoming question was found.";

    const result = await AIService<TelegramReplyGenerationOutput>({
      systemPrompt: `You are a Telegram reply assistant for a patient.

Write concise first-person replies that the patient can send in Telegram.
Use the knowledge base and the latest conversation together.
Stay consistent with patient facts and needs from the knowledge base.
Do not invent medical facts, diagnoses, medications, or capabilities.
Keep replies natural, safe, and sendable.
Return distinct options only.
Use the recent incoming questions to resolve references such as omitted names or pronouns.
If the knowledge base contains the answer to the latest question, answer it directly instead of giving a generic fallback.`,
      query: `Generate up to ${TELEGRAM_REPLY_LIMIT} short Telegram replies that the patient could send right now.

Contact context:
- Name: ${openChat.contact.name}
- Relation: ${openChat.contact.relation}
- Role: ${openChat.contact.role}
${openChat.contact.notes ? `- Notes: ${openChat.contact.notes}` : ""}

Latest incoming question to answer:
${latestIncomingText}

Recent related incoming questions:
${recentIncomingTexts.length ? recentIncomingTexts.map((text, index) => `${index + 1}. ${text}`).join("\n") : "No recent incoming questions were found."}

Latest chat transcript (oldest to newest):
${transcript || "No recent messages were found."}

Requirements:
- Reply as the patient in first person.
- Keep each reply short and practical for Telegram.
- Make the options meaningfully different from each other.
- The first option should be the most direct answer to the latest incoming question.
- If the knowledge base includes the requested fact, state it clearly.
- Only use uncertainty if the knowledge base and chat truly do not contain the answer.`,
      chunkCount: 15,
      knowledgeBaseQuery: buildKnowledgeBaseQuery(recentMessages, openChat.contact),
      structuredOutput: {
        name: "telegram_reply_suggestions",
        description: "Short Telegram reply suggestions for the patient to send.",
        schema: {
          type: "object",
          properties: {
            replies: {
              type: "array",
              maxItems: TELEGRAM_REPLY_LIMIT,
              items: {
                type: "object",
                properties: {
                  text: {
                    type: "string",
                    description: "A short Telegram reply the patient can send.",
                  },
                },
                required: ["text"],
                additionalProperties: false,
              },
            },
          },
          required: ["replies"],
          additionalProperties: false,
        },
      },
    });

    if (!result || typeof result !== "object" || !("replies" in result) || !Array.isArray(result.replies)) {
      throw new TelegramDomainError(
        "TELEGRAM_AI_REPLIES_UNAVAILABLE",
        503,
        "AI could not generate reply suggestions for this chat right now",
      );
    }

    const replyOptions = normalizeReplies(result.replies);

    if (!replyOptions.length) {
      throw new TelegramDomainError(
        "TELEGRAM_AI_REPLIES_UNAVAILABLE",
        503,
        "AI could not generate reply suggestions for this chat right now",
      );
    }

    return replyOptions;
  }
}

export const telegramAiReplyService = new TelegramAiReplyService();
