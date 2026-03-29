import "server-only";

import { cookies } from "next/headers";

import { getRequiredBackendBaseURL } from "./api-base";
import {
  TelegramAuthStatus,
  TelegramChat,
  TelegramContact,
  TelegramErrorDescriptor,
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

async function getRequestHeaders(initHeaders?: HeadersInit) {
  const cookieStore = await cookies();
  const headers = new Headers(initHeaders);
  headers.set("Accept", "application/json");

  const cookieHeader = cookieStore.toString();
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }

  return headers;
}

async function telegramServerFetch<T>(pathname: string, init?: RequestInit) {
  try {
    const response = await fetch(new URL(pathname, getRequiredBackendBaseURL()), {
      ...init,
      headers: await getRequestHeaders(init?.headers),
      cache: "no-store",
    });

    return parseTelegramResponse<T>(response);
  } catch (error) {
    if (error instanceof TelegramRequestError) {
      throw error;
    }

    throw new TelegramRequestError(
      503,
      "BACKEND_UNREACHABLE",
      "Could not reach the backend service. Ensure the server is running and NEXT_PUBLIC_BETTER_AUTH_URL points to it.",
    );
  }
}

export async function safeTelegramServerCall<T>(operation: () => Promise<T>) {
  try {
    return {
      data: await operation(),
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof TelegramRequestError
          ? error
          : new TelegramRequestError(
              500,
              "TELEGRAM_SERVER_FETCH_FAILED",
              "Failed to load Telegram data.",
            ),
    };
  }
}

export function serializeTelegramError(
  error: TelegramRequestError | null,
): TelegramErrorDescriptor | null {
  if (!error) {
    return null;
  }

  return {
    status: error.status,
    code: error.code,
    message: error.message,
  };
}

export const telegramServer = {
  getAuthStatus() {
    return telegramServerFetch<TelegramAuthStatus>("/api/telegram/auth/status");
  },
  listContacts() {
    return telegramServerFetch<TelegramContact[]>("/api/telegram/contacts");
  },
  listChats() {
    return telegramServerFetch<TelegramChat[]>("/api/telegram/chats");
  },
  openChat(contactId: string) {
    return telegramServerFetch<TelegramOpenChatResponse>(`/api/telegram/contacts/${contactId}/open-chat`, {
      method: "POST",
    });
  },
  getReplyOptions(chatId: string) {
    return telegramServerFetch<TelegramReplyOption[]>(`/api/telegram/chats/${chatId}/reply-options`);
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
    return telegramServerFetch<TelegramMessage[]>(
      `/api/telegram/chats/${chatId}/messages${query ? `?${query}` : ""}`,
    );
  },
};
