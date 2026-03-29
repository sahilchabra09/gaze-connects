import type { NecessityRequestEventData } from "@/lib/necessity/types";

export const TELEGRAM_AUTH_STATES = [
  "waiting_phone_number",
  "waiting_code",
  "waiting_password",
  "authenticated",
  "expired",
] as const;

export type TelegramAuthState = (typeof TELEGRAM_AUTH_STATES)[number];

export const TELEGRAM_CONTACT_ROLES = ["caretaker", "emergency", "contact"] as const;

export type TelegramContactRole = (typeof TELEGRAM_CONTACT_ROLES)[number];

export type TelegramAuthStatus = {
  authState: TelegramAuthState;
  telegramUserId: string | null;
  connectedAt: string | null;
  sessionPath: string;
};

export type TelegramContact = {
  id: string;
  patientId: string;
  role: TelegramContactRole;
  priorityRank: number;
  name: string;
  relation: string;
  phoneNumber: string;
  phoneNumberNormalized: string;
  telegramUserId: string | null;
  telegramChatId: string | null;
  isActive: boolean;
  notes: string | null;
  lastResolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TelegramChat = {
  chatId: string;
  contactId: string;
  title: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  lastMessageId: string | null;
  unreadCount: number;
};

export type TelegramMessage = {
  id: string;
  chatId: string;
  direction: "incoming" | "outgoing";
  text: string;
  contentType: string;
  sentAt: string;
  senderLabel: string | null;
};

export type TelegramReplyOption = {
  id: string;
  label: string;
  text: string;
  source: "ai-telegram";
};

export type TelegramOpenChatResponse = {
  contact: TelegramContact;
  chat: TelegramChat;
  messages: TelegramMessage[];
};

export type TelegramApiErrorPayload = {
  error: string;
  message: string;
};

export type TelegramErrorDescriptor = {
  status: number;
  code: string;
  message: string;
};

export type TelegramContactMutationInput = {
  name: string;
  relation: string;
  phoneNumber: string;
  role: TelegramContactRole;
  priorityRank?: number;
  notes?: string | null;
  isActive?: boolean;
};

export type TelegramContactUpdateInput = Partial<TelegramContactMutationInput>;

export type TelegramContactUpdatedEventData = {
  action: "created" | "updated" | "deleted";
  contact?: TelegramContact;
  contactId?: string;
};

export type TelegramMessageEventData = {
  chatId: string;
  message: TelegramMessage;
  chat: TelegramChat;
};

export type TelegramChatOpenedEventData = {
  contact: TelegramContact;
  chat: TelegramChat;
};

export type TelegramHeartbeatEventData = {
  timestamp: string;
};

export type TelegramEventMap = {
  ready: TelegramAuthStatus;
  heartbeat: TelegramHeartbeatEventData;
  auth_state: TelegramAuthStatus;
  contact_updated: TelegramContactUpdatedEventData;
  chat_opened: TelegramChatOpenedEventData;
  message_new: TelegramMessageEventData;
  message_sent: TelegramMessageEventData;
  necessity_request_created: NecessityRequestEventData;
  necessity_request_acknowledged: NecessityRequestEventData;
  necessity_request_escalated: NecessityRequestEventData;
};

export type TelegramEventType = keyof TelegramEventMap;

export type TelegramEvent<TType extends TelegramEventType = TelegramEventType> = {
  type: TType;
  data: TelegramEventMap[TType];
};

export type TelegramLiveConnectionState = "connecting" | "open" | "closed" | "error";

export class TelegramRequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "TelegramRequestError";
    this.status = status;
    this.code = code;
  }
}

export function isTelegramRequestError(error: unknown): error is TelegramRequestError {
  return error instanceof TelegramRequestError;
}
