"use client";

import { toBackendURL } from "./api-base";
import {
  TelegramAuthStatus,
  TelegramChat,
  TelegramContact,
  TelegramContactMutationInput,
  TelegramContactUpdateInput,
  TelegramOpenChatResponse,
  TelegramReplyOption,
  TelegramMessage,
  TelegramRequestError,
  type TelegramApiErrorPayload,
} from "./types";

async function parseTelegramResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? ((await response.json()) as T | TelegramApiErrorPayload) : null;

  if (!response.ok) {
    const errorPayload = payload as TelegramApiErrorPayload | null;
    throw new TelegramRequestError(
      response.status,
      errorPayload?.error ?? "REQUEST_FAILED",
      errorPayload?.message ?? (response.statusText || "Telegram request failed"),
    );
  }

  return payload as T;
}

async function telegramClientFetch<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(toBackendURL(pathname), {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  return parseTelegramResponse<T>(response);
}

export const telegramClient = {
  getAuthStatus() {
    return telegramClientFetch<TelegramAuthStatus>("/api/telegram/auth/status");
  },
  startAuth(phoneNumber: string) {
    return telegramClientFetch<TelegramAuthStatus>("/api/telegram/auth/start", {
      method: "POST",
      body: JSON.stringify({ phoneNumber }),
    });
  },
  verifyCode(code: string) {
    return telegramClientFetch<TelegramAuthStatus>("/api/telegram/auth/verify-code", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  },
  listContacts() {
    return telegramClientFetch<TelegramContact[]>("/api/telegram/contacts");
  },
  createContact(input: TelegramContactMutationInput) {
    return telegramClientFetch<TelegramContact>("/api/telegram/contacts", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateContact(contactId: string, input: TelegramContactUpdateInput) {
    return telegramClientFetch<TelegramContact>(`/api/telegram/contacts/${contactId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  deleteContact(contactId: string) {
    return telegramClientFetch<{ ok: boolean }>(`/api/telegram/contacts/${contactId}`, {
      method: "DELETE",
    });
  },
  listChats() {
    return telegramClientFetch<TelegramChat[]>("/api/telegram/chats");
  },
  openChat(contactId: string) {
    return telegramClientFetch<TelegramOpenChatResponse>(`/api/telegram/contacts/${contactId}/open-chat`, {
      method: "POST",
    });
  },
  getMessages(chatId: string, options?: { limit?: number; fromMessageId?: string }) {
    const searchParams = new URLSearchParams();

    if (options?.limit) {
      searchParams.set("limit", String(options.limit));
    }

    if (options?.fromMessageId) {
      searchParams.set("fromMessageId", options.fromMessageId);
    }

    const query = searchParams.toString();
    return telegramClientFetch<TelegramMessage[]>(
      `/api/telegram/chats/${chatId}/messages${query ? `?${query}` : ""}`,
    );
  },
  sendMessage(chatId: string, text: string, source?: string) {
    return telegramClientFetch<TelegramMessage>(`/api/telegram/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text, source }),
    });
  },
  getReplyOptions(chatId: string) {
    return telegramClientFetch<TelegramReplyOption[]>(`/api/telegram/chats/${chatId}/reply-options`);
  },
};
