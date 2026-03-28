import type { TelegramMessage, TelegramReplyOption } from "./types";

const KEYWORD_TO_REPLY_ID: Array<{ pattern: RegExp; replyId: string }> = [
  { pattern: /\bwater|drink|thirst/i, replyId: "i-need-water" },
  { pattern: /\bmedicine|tablet|meds/i, replyId: "i-need-medicine" },
  { pattern: /\bpain|hurts|ache/i, replyId: "i-am-in-pain" },
  { pattern: /\bcome|here|urgent|now/i, replyId: "please-come-here" },
  { pattern: /\bhelp|assist|emergency/i, replyId: "i-need-help" },
  { pattern: /\bcall|phone/i, replyId: "call-me" },
  { pattern: /\bwait|later|hold/i, replyId: "please-wait" },
  { pattern: /\bthanks|thank you|grateful/i, replyId: "thank-you" },
  { pattern: /\bokay|ok|fine|good/i, replyId: "im-okay" },
  { pattern: /\byes|yeah|yep/i, replyId: "yes" },
  { pattern: /\bno|nope/i, replyId: "no" },
];

const FALLBACK_REPLY_IDS = ["im-okay", "please-wait", "thank-you", "yes", "no", "call-me"] as const;

function toDummyReply(option: TelegramReplyOption, index: number): TelegramReplyOption {
  return {
    id: `ai-dummy-${index + 1}-${option.id}`,
    label: option.label,
    text: option.text,
    source: "ai-dummy",
  };
}

export function buildDummyAiReplyOptions(
  messages: TelegramMessage[],
  staticOptions: TelegramReplyOption[],
): TelegramReplyOption[] {
  const latestMessages = messages.slice(0, 20);
  const recentIncomingText = latestMessages
    .filter((message) => message.direction === "incoming")
    .slice(0, 3)
    .map((message) => message.text)
    .join(" ");

  const optionById = new Map(staticOptions.map((option) => [option.id, option]));
  const picked = new Map<string, TelegramReplyOption>();

  for (const rule of KEYWORD_TO_REPLY_ID) {
    if (picked.size >= 3) {
      break;
    }

    if (!rule.pattern.test(recentIncomingText)) {
      continue;
    }

    const option = optionById.get(rule.replyId);
    if (option) {
      picked.set(option.id, option);
    }
  }

  for (const replyId of FALLBACK_REPLY_IDS) {
    if (picked.size >= 3) {
      break;
    }

    const option = optionById.get(replyId);
    if (option) {
      picked.set(option.id, option);
    }
  }

  for (const option of staticOptions) {
    if (picked.size >= 3) {
      break;
    }

    picked.set(option.id, option);
  }

  return Array.from(picked.values()).slice(0, 3).map(toDummyReply);
}
