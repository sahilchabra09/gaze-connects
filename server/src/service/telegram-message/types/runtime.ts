import type { TelegramAuthState } from "./common";

export type TelegramRuntimeStatus = {
  authState: TelegramAuthState
  telegramUserId: string | null
  connectedAt: string | null
  sessionPath: string
};

export type ChatSummary = {
  chatId: string
  contactId: string
  title: string
  lastMessagePreview: string | null
  lastMessageAt: string | null
  lastMessageId: string | null
  unreadCount: number
};

export type ChatMessage = {
  id: string
  chatId: string
  direction: "incoming" | "outgoing"
  text: string
  contentType: string
  sentAt: string
  senderLabel: string | null
};