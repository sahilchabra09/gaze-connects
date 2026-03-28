export const TELEGRAM_AUTH_STATES = [
  "waiting_phone_number",
  "waiting_code",
  "waiting_password",
  "authenticated",
  "expired",
] as const;

export type TelegramAuthState = (typeof TELEGRAM_AUTH_STATES)[number];

export const CONTACT_ROLES = ["caretaker", "emergency", "contact"] as const;

export type ContactRole = (typeof CONTACT_ROLES)[number];

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

export type ReplyOption = {
  id: string
  label: string
  text: string
  source: "static"
};

export type TelegramEventPayload = {
  type: string
  data: unknown
};
