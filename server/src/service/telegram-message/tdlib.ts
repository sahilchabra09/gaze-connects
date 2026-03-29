import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { getTdjson } from "prebuilt-tdlib";
import * as tdl from "tdl";
import { db } from "@/db";
import { patientTelegramSession } from "@/db/schema";
import { logger, serializeError } from "@/lib/logger";
import { necessityService } from "@/service/necessity/service";
import { contactService } from "./contact-service";
import { telegramConfig, ensureTelegramStorage } from "./config";
import { TelegramDomainError } from "./errors";
import { toTelegramPhoneNumber } from "./phone";
import { telegramSseBroker } from "./sse-broker";
import type {
  ChatMessage,
  ChatSummary,
  EnsureRuntimeOptions,
  PatientContactRecord,
  PatientRuntime,
  TelegramAuthState,
  TelegramRuntimeStatus,
  TdChat,
  TdMessage,
  TdObject,
  TdlibClient,
} from "./types";

let tdlibConfigured = false;

function configureTdlib(): void {
  if (tdlibConfigured) {
    return;
  }

  tdl.configure({
    tdjson: getTdjson(),
    verbosityLevel: 1,
  });
  tdlibConfigured = true;
}

function toSessionPath(patientId: string): string {
  return join(telegramConfig.sessionsDir, `patient_${patientId}`);
}

function toTdlibBytes(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function maskPhoneNumber(value: string): string {
  if (value.length <= 6) {
    return value;
  }

  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function toIdString(value: string | number | bigint | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

function toTdlibId(value: string, kind: "chat" | "user"): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new TelegramDomainError(
      "TELEGRAM_ID_INVALID",
      409,
      `Stored Telegram ${kind} id is invalid. Reconnect Telegram and try again`,
    );
  }

  return parsed;
}

function toIsoFromUnix(value: number | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

function getMessageContentPreview(content: TdObject | undefined): { text: string; contentType: string } {
  if (!content) {
    return { text: "", contentType: "unknown" };
  }

  switch (content._) {
    case "messageText":
      return {
        text: content.text.text,
        contentType: "text",
      };
    case "messagePhoto":
      return {
        text: content.caption.text || "[Photo]",
        contentType: "photo",
      };
    case "messageVoiceNote":
      return {
        text: "[Voice message]",
        contentType: "voice",
      };
    case "messageSticker":
      return {
        text: "[Sticker]",
        contentType: "sticker",
      };
    case "messageDocument":
      return {
        text: content.caption.text || "[Document]",
        contentType: "document",
      };
    default:
      return {
        text: `[${content._}]`,
        contentType: content._,
      };
  }
}

function toChatMessage(message: TdMessage): ChatMessage {
  const preview = getMessageContentPreview(message.content);

  return {
    id: String(message.id),
    chatId: String(message.chat_id),
    direction: message.is_outgoing ? "outgoing" : "incoming",
    text: preview.text,
    contentType: preview.contentType,
    sentAt: toIsoFromUnix(message.date) ?? new Date().toISOString(),
    senderLabel: null,
  };
}

function toChatSummary(chat: TdChat, contact: PatientContactRecord): ChatSummary {
  const lastMessage = chat.last_message as TdMessage | undefined;
  const preview = getMessageContentPreview(lastMessage?.content);

  return {
    chatId: String(chat.id),
    contactId: contact.id,
    title: chat.title,
    lastMessagePreview: lastMessage ? preview.text : null,
    lastMessageAt: lastMessage ? toIsoFromUnix(lastMessage.date) : null,
    lastMessageId: lastMessage ? String(lastMessage.id) : null,
    unreadCount: chat.unread_count,
  };
}

function compareChats(a: ChatSummary, b: ChatSummary, contacts: Map<string, PatientContactRecord>): number {
  const left = contacts.get(a.contactId);
  const right = contacts.get(b.contactId);

  if (!left || !right) {
    return 0;
  }

  if (left.priorityRank !== right.priorityRank) {
    return left.priorityRank - right.priorityRank;
  }

  const leftTime = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
  const rightTime = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
  return rightTime - leftTime;
}

function isTdlibNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  const message = "message" in error ? String((error as { message?: unknown }).message) : "";

  return code === 404 || message.includes("404") || message.includes("not found");
}

function isRecoverableChatLookupError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "").toLowerCase() : "";

  if (isTdlibNotFound(error)) {
    return true;
  }

  return (
    code === 400
    || message.includes("chat not found")
    || message.includes("have no chat")
    || message.includes("have no access")
    || message.includes("invalid chat")
  );
}

function isTdlibWrongDatabaseEncryptionKey(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return message.includes("Wrong database encryption key");
}

function isTdlibAuthKeyDuplicated(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const rawCode = "code" in error ? (error as { code?: unknown }).code : undefined;
  const code = typeof rawCode === "number" ? rawCode : Number(rawCode);
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";

  return code === 406 && message.includes("AUTH_KEY_DUPLICATED");
}

function mapTdlibAuthError(error: unknown): TelegramDomainError | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const rawCode = "code" in error ? (error as { code?: unknown }).code : undefined;
  const code = typeof rawCode === "number" ? rawCode : Number(rawCode);
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";

  if (message.includes("PHONE_CODE_INVALID")) {
    return new TelegramDomainError("TELEGRAM_CODE_INVALID", 400, "Invalid Telegram verification code");
  }

  if (message.includes("PHONE_CODE_EXPIRED")) {
    return new TelegramDomainError("TELEGRAM_CODE_EXPIRED", 400, "Telegram verification code has expired");
  }

  if (message.includes("PHONE_NUMBER_INVALID")) {
    return new TelegramDomainError("TELEGRAM_PHONE_INVALID", 400, "Telegram phone number is invalid");
  }

  if (
    message.includes("Call to setAuthenticationPhoneNumber unexpected") ||
    message.includes("setAuthenticationPhoneNumber unexpected")
  ) {
    return new TelegramDomainError(
      "TELEGRAM_AUTH_ALREADY_IN_PROGRESS",
      409,
      "Telegram authentication is already in progress. Enter the verification code or refresh auth status.",
    );
  }

  if (
    message.includes("Call to checkAuthenticationCode unexpected") ||
    message.includes("checkAuthenticationCode unexpected")
  ) {
    return new TelegramDomainError(
      "TELEGRAM_CODE_NOT_REQUESTED",
      409,
      "Telegram is not waiting for a verification code. Refresh auth status before entering a code.",
    );
  }

  if (message.includes("PHONE_NUMBER_FLOOD") || message.includes("FLOOD_WAIT") || code === 429) {
    return new TelegramDomainError("TELEGRAM_RATE_LIMIT", 429, "Too many Telegram attempts. Please try again later");
  }

  if (message.includes("Initialization parameters are needed")) {
    return new TelegramDomainError("TELEGRAM_INITIALIZING", 503, "Telegram session is still initializing. Please retry in a moment");
  }

  if (message.includes("Wrong database encryption key")) {
    return new TelegramDomainError("TELEGRAM_ENCRYPTION_KEY_MISMATCH", 409, "Telegram session data was encrypted with a different key. Reset the Telegram session and authenticate again");
  }

  if (isTdlibAuthKeyDuplicated(error)) {
    return new TelegramDomainError(
      "TELEGRAM_AUTH_KEY_DUPLICATED",
      409,
      "Telegram session was opened in another client. Reconnect Telegram and try again",
    );
  }

  return null;
}

function mapAuthorizationState(state: TdObject): TelegramAuthState {
  switch (state._) {
    case "authorizationStateWaitPhoneNumber":
      return "waiting_phone_number";
    case "authorizationStateWaitCode":
      return "waiting_code";
    case "authorizationStateWaitPassword":
      return "waiting_password";
    case "authorizationStateReady":
      return "authenticated";
    case "authorizationStateClosed":
    case "authorizationStateClosing":
      return "expired";
    default:
      return "waiting_phone_number";
  }
}

export class TelegramClientManager {
  private readonly runtimes = new Map<string, PatientRuntime>();
  private readonly runtimeInitializations = new Map<string, Promise<PatientRuntime>>();
  private readonly runtimeWarmups = new Map<string, Promise<void>>();
  private readonly keyMismatchPatients = new Set<string>();
  private readonly authKeyDuplicatedPatients = new Set<string>();
  private initialization: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.initialization) {
      return this.initialization;
    }

    this.initialization = (async () => {
      configureTdlib();
      await ensureTelegramStorage();
      await this.restorePersistedSessions();
    })();

    return this.initialization;
  }

  async getStatus(patientId: string): Promise<TelegramRuntimeStatus> {
    await this.initialize();

    const runtime = this.runtimes.get(patientId);
    if (runtime) {
      try {
        return await this.refreshRuntimeState(patientId);
      } catch (error) {
        const mapped = mapTdlibAuthError(error);
        if (mapped?.code === "TELEGRAM_AUTH_KEY_DUPLICATED") {
          await this.markRuntimeExpiredOnAuthKeyDuplication(
            patientId,
            runtime.sessionPath,
            error,
            "telegram.get-status",
          );
          throw mapped;
        }

        if (mapped) {
          throw mapped;
        }

        throw error;
      }
    }

    const existing = await db
      .select()
      .from(patientTelegramSession)
      .where(eq(patientTelegramSession.patientId, patientId));

    const persisted = existing[0];
    if (!persisted) {
      return {
        authState: "waiting_phone_number",
        telegramUserId: null,
        connectedAt: null,
        sessionPath: toSessionPath(patientId),
      };
    }

    return {
      authState: persisted.authState as TelegramAuthState,
      telegramUserId: persisted.telegramUserId,
      connectedAt: persisted.connectedAt?.toISOString() ?? null,
      sessionPath: persisted.sessionPath,
    };
  }

  async warmUpForUser(patientId: string): Promise<void> {
    if (this.authKeyDuplicatedPatients.has(patientId)) {
      return;
    }

    if (this.runtimes.has(patientId) && !this.runtimeInitializations.has(patientId)) {
      return;
    }

    const inProgress = this.runtimeWarmups.get(patientId);
    if (inProgress) {
      return inProgress;
    }

    const warmup = this.ensureRuntime(patientId)
      .then(() => {
        logger.info({ patientId }, "telegram runtime warmed up for signed-in user");
      })
      .catch((error) => {
        logger.warn(
          {
            patientId,
            error: serializeError(error),
          },
          "telegram runtime warm-up failed",
        );
      })
      .finally(() => {
        this.runtimeWarmups.delete(patientId);
      });

    this.runtimeWarmups.set(patientId, warmup);
    return warmup;
  }

  async startAuthentication(patientId: string, phoneNumber: string): Promise<TelegramRuntimeStatus> {
    this.authKeyDuplicatedPatients.delete(patientId);
    const runtime = await this.ensureRuntime(patientId);
    const normalizedPhoneNumber = toTelegramPhoneNumber(phoneNumber);

    const statusBefore = await this.refreshRuntimeState(patientId);
    if (statusBefore.authState === "authenticated" || statusBefore.authState === "waiting_code") {
      return statusBefore;
    }

    if (statusBefore.authState === "waiting_password") {
      throw new TelegramDomainError(
        "TELEGRAM_2FA_UNSUPPORTED",
        409,
        "Telegram accounts with 2-step password are not supported in this version",
      );
    }

    logger.info(
      {
        operation: "telegram.start-auth",
        patientId,
        sessionPath: runtime.sessionPath,
        authStateBefore: statusBefore.authState,
        phoneNumber: maskPhoneNumber(normalizedPhoneNumber),
      },
      "starting telegram phone authentication",
    );

    try {
      await runtime.client.invoke({
        _: "setAuthenticationPhoneNumber",
        phone_number: normalizedPhoneNumber,
      } as any);
    } catch (error) {
      const mappedError = mapTdlibAuthError(error);
      if (mappedError?.code === "TELEGRAM_AUTH_KEY_DUPLICATED") {
        await this.markRuntimeExpiredOnAuthKeyDuplication(
          patientId,
          runtime.sessionPath,
          error,
          "telegram.start-auth",
        );
        throw mappedError;
      }

      if (mappedError?.code === "TELEGRAM_INITIALIZING") {
        const hasKeyMismatch =
          this.keyMismatchPatients.has(patientId) || (await this.waitForKeyMismatchSignal(patientId));

        logger.warn(
          {
            operation: "telegram.start-auth",
            patientId,
            sessionPath: runtime.sessionPath,
            hasKeyMismatch,
          },
          hasKeyMismatch
            ? "telegram runtime has encryption-key mismatch; clearing session storage and recreating runtime"
            : "telegram runtime stuck initializing; recreating runtime and retrying start-auth",
        );

        if (hasKeyMismatch) {
          await this.resetSessionStorage(patientId);
        }

        const recreatedRuntime = await this.ensureRuntime(patientId, { forceRecreate: true });

        try {
          await recreatedRuntime.client.invoke({
            _: "setAuthenticationPhoneNumber",
            phone_number: normalizedPhoneNumber,
          } as any);
        } catch (retryError) {
          const retryMappedError = mapTdlibAuthError(retryError);
          if (retryMappedError?.code === "TELEGRAM_AUTH_KEY_DUPLICATED") {
            await this.markRuntimeExpiredOnAuthKeyDuplication(
              patientId,
              recreatedRuntime.sessionPath,
              retryError,
              "telegram.start-auth.retry",
            );
            throw retryMappedError;
          }

          const retryHasKeyMismatch =
            this.keyMismatchPatients.has(patientId) ||
            isTdlibWrongDatabaseEncryptionKey(retryError) ||
            (retryMappedError?.code === "TELEGRAM_ENCRYPTION_KEY_MISMATCH") ||
            (retryMappedError?.code === "TELEGRAM_INITIALIZING" &&
              (await this.waitForKeyMismatchSignal(patientId)));

          if (retryHasKeyMismatch) {
            logger.warn(
              {
                operation: "telegram.start-auth",
                patientId,
                sessionPath: recreatedRuntime.sessionPath,
              },
              "detected delayed encryption-key mismatch while retrying start-auth; resetting session storage and retrying",
            );

            await this.resetSessionStorage(patientId);
            const resetRuntime = await this.ensureRuntime(patientId, { forceRecreate: true });

            try {
              await resetRuntime.client.invoke({
                _: "setAuthenticationPhoneNumber",
                phone_number: normalizedPhoneNumber,
              } as any);
            } catch (resetRetryError) {
              const resetRetryMappedError = mapTdlibAuthError(resetRetryError);
              if (resetRetryMappedError?.code === "TELEGRAM_AUTH_KEY_DUPLICATED") {
                await this.markRuntimeExpiredOnAuthKeyDuplication(
                  patientId,
                  resetRuntime.sessionPath,
                  resetRetryError,
                  "telegram.start-auth.reset-retry",
                );
                throw resetRetryMappedError;
              }

              if (resetRetryMappedError) {
                throw resetRetryMappedError;
              }

              logger.error(
                {
                  operation: "telegram.start-auth",
                  patientId,
                  sessionPath: resetRuntime.sessionPath,
                  authStateBefore: resetRuntime.authState,
                  phoneNumber: maskPhoneNumber(normalizedPhoneNumber),
                  error: serializeError(resetRetryError),
                },
                "setAuthenticationPhoneNumber failed after storage reset and runtime recreation",
              );
              throw resetRetryError;
            }

            const status = await this.refreshRuntimeState(patientId);
            logger.info(
              {
                operation: "telegram.start-auth",
                patientId,
                sessionPath: status.sessionPath,
                authStateAfter: status.authState,
              },
              "telegram phone authentication request accepted after encryption-key mismatch reset",
            );
            return status;
          }

          if (retryMappedError) {
            throw retryMappedError;
          }

          logger.error(
            {
              operation: "telegram.start-auth",
              patientId,
              sessionPath: recreatedRuntime.sessionPath,
              authStateBefore: recreatedRuntime.authState,
              phoneNumber: maskPhoneNumber(normalizedPhoneNumber),
              error: serializeError(retryError),
            },
            "setAuthenticationPhoneNumber failed after runtime recreation",
          );
          throw retryError;
        }
      } else if (mappedError) {
        throw mappedError;
      } else {
        logger.error(
          {
            operation: "telegram.start-auth",
            patientId,
            sessionPath: runtime.sessionPath,
            authStateBefore: runtime.authState,
            phoneNumber: maskPhoneNumber(normalizedPhoneNumber),
            error: serializeError(error),
          },
          "setAuthenticationPhoneNumber failed",
        );
        throw error;
      }
    }

    const status = await this.refreshRuntimeState(patientId);
    this.keyMismatchPatients.delete(patientId);
    logger.info(
      {
        operation: "telegram.start-auth",
        patientId,
        sessionPath: runtime.sessionPath,
        authStateAfter: status.authState,
      },
      "telegram phone authentication request accepted",
    );
    return status;
  }

  async verifyCode(patientId: string, code: string): Promise<TelegramRuntimeStatus> {
    this.authKeyDuplicatedPatients.delete(patientId);
    const runtime = await this.ensureRuntime(patientId);
    const statusBefore = await this.refreshRuntimeState(patientId);

    if (statusBefore.authState === "authenticated") {
      throw new TelegramDomainError(
        "TELEGRAM_ALREADY_CONNECTED",
        409,
        "Telegram is already connected. No verification code is required.",
      );
    }

    if (statusBefore.authState !== "waiting_code") {
      throw new TelegramDomainError(
        "TELEGRAM_CODE_NOT_REQUESTED",
        409,
        "Telegram is not waiting for a verification code. Start auth and wait for the code step first.",
      );
    }

    logger.info(
      {
        operation: "telegram.verify-code",
        patientId,
        sessionPath: runtime.sessionPath,
        authStateBefore: statusBefore.authState,
        codeLength: code.length,
      },
      "verifying telegram authentication code",
    );

    try {
      await runtime.client.invoke({
        _: "checkAuthenticationCode",
        code,
      } as any);
    } catch (error) {
      const mappedError = mapTdlibAuthError(error);
      if (mappedError?.code === "TELEGRAM_AUTH_KEY_DUPLICATED") {
        await this.markRuntimeExpiredOnAuthKeyDuplication(
          patientId,
          runtime.sessionPath,
          error,
          "telegram.verify-code",
        );
        throw mappedError;
      }

      if (mappedError) {
        throw mappedError;
      }

      logger.error(
        {
          operation: "telegram.verify-code",
          patientId,
          sessionPath: runtime.sessionPath,
          authStateBefore: statusBefore.authState,
          codeLength: code.length,
          error: serializeError(error),
        },
        "checkAuthenticationCode failed",
      );
      throw error;
    }

    const status = await this.refreshRuntimeState(patientId);
    this.keyMismatchPatients.delete(patientId);
    if (status.authState === "waiting_password") {
      throw new TelegramDomainError(
        "TELEGRAM_2FA_UNSUPPORTED",
        409,
        "Telegram accounts with 2-step password are not supported in this version",
      );
    }

    return status;
  }

  async listChats(patientId: string): Promise<ChatSummary[]> {
    const runtime = await this.ensureAuthenticatedRuntime(patientId);
    const contacts = await contactService.listActiveMapped(patientId);
    const byId = new Map(contacts.map((contact) => [contact.id, contact]));
    const chats = (
      await Promise.all(
        contacts.map(async (contact) => {
          if (!contact.telegramChatId) {
            return null;
          }

          try {
            return await this.fetchChatSummary(runtime, contact, contact.telegramChatId);
          } catch (error) {
            if (isRecoverableChatLookupError(error)) {
              logger.warn(
                {
                  error: serializeError(error),
                  patientId,
                  contactId: contact.id,
                  chatId: contact.telegramChatId,
                },
                "stored telegram chat id failed during chat listing; resolving fresh chat mapping",
              );

              try {
                const refreshedContact = await this.resolveContactChat(runtime, contact);
                return await this.fetchChatSummary(runtime, refreshedContact, refreshedContact.telegramChatId!);
              } catch (retryError) {
                logger.warn(
                  {
                    error: serializeError(retryError),
                    patientId,
                    contactId: contact.id,
                  },
                  "failed to refresh telegram chat mapping during chat listing",
                );
                return null;
              }
            }

            logger.warn({ error: serializeError(error), patientId, contactId: contact.id }, "failed to fetch chat summary");
            return null;
          }
        }),
      )
    ).filter((chat): chat is ChatSummary => chat !== null);

    chats.sort((left, right) => compareChats(left, right, byId));
    return chats;
  }

  async openChat(patientId: string, contactId: string): Promise<{
    contact: PatientContactRecord
    chat: ChatSummary
    messages: ChatMessage[]
  }> {
    const runtime = await this.ensureAuthenticatedRuntime(patientId);
    let contact = await contactService.getActiveById(patientId, contactId);

    if (!contact.telegramChatId) {
      contact = await this.resolveContactChat(runtime, contact);
    }

    let chat: ChatSummary;
    let messages: ChatMessage[];

    try {
      chat = await this.fetchChatSummary(runtime, contact, contact.telegramChatId!);
      messages = await this.getMessages(patientId, contact.telegramChatId!, 100);
    } catch (error) {
      if (!isRecoverableChatLookupError(error)) {
        throw error;
      }

      logger.warn(
        {
          patientId,
          contactId: contact.id,
          chatId: contact.telegramChatId,
          error: serializeError(error),
        },
        "stored telegram chat id not found; resolving a fresh chat mapping",
      );

      contact = await this.resolveContactChat(runtime, contact);
      chat = await this.fetchChatSummary(runtime, contact, contact.telegramChatId!);
      messages = await this.getMessages(patientId, contact.telegramChatId!, 100);
    }

    telegramSseBroker.publish(patientId, "chat_opened", {
      contact,
      chat,
    });

    return { contact, chat, messages };
  }

  async getMessages(
    patientId: string,
    chatId: string,
    limit = 100,
    fromMessageId?: string,
  ): Promise<ChatMessage[]> {
    const runtime = await this.ensureAuthenticatedRuntime(patientId);
    await contactService.getActiveByChatId(patientId, chatId);
    const tdlibChatId = toTdlibId(chatId, "chat");

    let history: { messages?: unknown[] };
    try {
      history = (await runtime.client.invoke({
        _: "getChatHistory",
        chat_id: tdlibChatId,
        from_message_id: fromMessageId ?? 0,
        offset: 0,
        limit,
        only_local: false,
      } as any)) as { messages?: unknown[] };
    } catch (error) {
      const mapped = mapTdlibAuthError(error);
      if (mapped?.code === "TELEGRAM_AUTH_KEY_DUPLICATED") {
        await this.markRuntimeExpiredOnAuthKeyDuplication(
          runtime.patientId,
          runtime.sessionPath,
          error,
          "telegram.get-messages",
        );
        throw mapped;
      }

      if (mapped) {
        throw mapped;
      }

      throw error;
    }

    const messages = history.messages ?? [];
    return messages.map((message: unknown) => toChatMessage(message as TdMessage));
  }

  async sendMessage(
    patientId: string,
    chatId: string,
    text: string,
  ): Promise<ChatMessage> {
    const runtime = await this.ensureAuthenticatedRuntime(patientId);
    let contact = await contactService.getActiveByChatId(patientId, chatId);
    let targetChatId = chatId;

    const invokeSend = async (resolvedChatId: string): Promise<TdMessage> => {
      return (await runtime.client.invoke({
        _: "sendMessage",
        chat_id: toTdlibId(resolvedChatId, "chat"),
        input_message_content: {
          _: "inputMessageText",
          text: {
            _: "formattedText",
            text,
            entities: [],
          },
          clear_draft: true,
        },
      } as any)) as TdMessage;
    };

    let sent: TdMessage;
    try {
      sent = await invokeSend(targetChatId);
    } catch (error) {
      const mapped = mapTdlibAuthError(error);
      if (mapped?.code === "TELEGRAM_AUTH_KEY_DUPLICATED") {
        await this.markRuntimeExpiredOnAuthKeyDuplication(
          runtime.patientId,
          runtime.sessionPath,
          error,
          "telegram.send-message",
        );
        throw mapped;
      }

      if (mapped) {
        throw mapped;
      }

      if (isRecoverableChatLookupError(error)) {
        logger.warn(
          {
            patientId,
            contactId: contact.id,
            chatId: targetChatId,
            error: serializeError(error),
          },
          "stored telegram chat id not found during send; resolving fresh chat mapping and retrying",
        );

        contact = await this.resolveContactChat(runtime, contact);
        targetChatId = contact.telegramChatId!;

        try {
          sent = await invokeSend(targetChatId);
        } catch (retryError) {
          const retryMapped = mapTdlibAuthError(retryError);
          if (retryMapped?.code === "TELEGRAM_AUTH_KEY_DUPLICATED") {
            await this.markRuntimeExpiredOnAuthKeyDuplication(
              runtime.patientId,
              runtime.sessionPath,
              retryError,
              "telegram.send-message.retry",
            );
            throw retryMapped;
          }

          if (retryMapped) {
            throw retryMapped;
          }

          if (isRecoverableChatLookupError(retryError)) {
            throw new TelegramDomainError(
              "CONTACT_NOT_ON_TELEGRAM",
              404,
              "Saved contact is not available on Telegram",
            );
          }

          throw retryError;
        }
      } else {
        throw error;
      }
    }

    const mapped = toChatMessage(sent as TdMessage);
    const chat = await this.fetchChatSummary(runtime, contact, targetChatId);

    telegramSseBroker.publish(patientId, "message_sent", {
      chatId: targetChatId,
      message: mapped,
      chat,
    });

    return mapped;
  }

  private async restorePersistedSessions(): Promise<void> {
    const sessions = await db
      .select()
      .from(patientTelegramSession)
      .where(
        inArray(patientTelegramSession.authState, [
          "authenticated",
          "waiting_code",
          "waiting_password",
        ]),
      );

    for (const session of sessions) {
      if (session.authState === "authenticated" && !session.telegramUserId) {
        logger.warn(
          {
            patientId: session.patientId,
            sessionPath: session.sessionPath,
          },
          "skipping invalid persisted telegram session with authenticated state but missing telegram user id",
        );

        await db
          .update(patientTelegramSession)
          .set({
            authState: "expired",
            connectedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(patientTelegramSession.patientId, session.patientId));

        continue;
      }

      try {
        await this.ensureRuntime(session.patientId, { skipInitialize: true });
      } catch (error) {
        logger.error({ error, patientId: session.patientId }, "failed to restore telegram session");
      }
    }
  }

  private async ensureRuntime(patientId: string, options?: EnsureRuntimeOptions): Promise<PatientRuntime> {
    if (!options?.skipInitialize) {
      await this.initialize();
    }

    const inProgress = this.runtimeInitializations.get(patientId);
    if (inProgress) {
      if (options?.forceRecreate) {
        try {
          await inProgress;
        } catch {
          // Ignore and continue with recreation below.
        }
      } else {
        return inProgress;
      }
    }

    if (options?.forceRecreate) {
      await this.disposeRuntime(patientId);
    }

    const existing = this.runtimes.get(patientId);
    if (existing) {
      return existing;
    }

    const runtimeInitialization = (async () => {
      const sessionPath = toSessionPath(patientId);
      await mkdir(join(sessionPath, "db"), { recursive: true });
      await mkdir(join(sessionPath, "files"), { recursive: true });

      const client = tdl.createClient({
        apiId: telegramConfig.apiId,
        apiHash: telegramConfig.apiHash,
        databaseDirectory: join(sessionPath, "db"),
        filesDirectory: join(sessionPath, "files"),
        databaseEncryptionKey: toTdlibBytes(telegramConfig.encryptionKey),
        tdlibParameters: {
          use_message_database: false,
          use_chat_info_database: false,
          use_file_database: false,
          use_secret_chats: false,
          system_language_code: "en",
          application_version: "1.0.0",
          device_model: "GazeConnect Server",
          system_version: "Bun/Elysia",
        },
      });

      const runtime: PatientRuntime = {
        patientId,
        sessionPath,
        client,
        authState: "waiting_phone_number",
        telegramUserId: null,
        connectedAt: null,
      };

      client.on("update", (update: unknown) => {
        void this.handleUpdate(patientId, update as TdObject).catch((error) => {
          void this.handleBackgroundTdlibError(patientId, sessionPath, error, "tdlib.update");
        });
      });

      client.on("error", (error: unknown) => {
        if (isTdlibWrongDatabaseEncryptionKey(error)) {
          this.keyMismatchPatients.add(patientId);
        }

        if (isTdlibAuthKeyDuplicated(error)) {
          void this.markRuntimeExpiredOnAuthKeyDuplication(patientId, sessionPath, error, "tdlib.client.error").catch((markError) => {
            logger.warn(
              {
                patientId,
                sessionPath,
                error: serializeError(markError),
              },
              "failed to mark runtime expired after AUTH_KEY_DUPLICATED in tdlib client error callback",
            );
          });
          return;
        }

        logger.error(
          {
            patientId,
            sessionPath,
            error: serializeError(error),
          },
          "tdlib client error",
        );
      });

      this.runtimes.set(patientId, runtime);

      try {
        if ("connect" in client && typeof client.connect === "function") {
          await client.connect();
        }

        await this.persistRuntime(runtime);
        await this.refreshRuntimeState(patientId);
        return runtime;
      } catch (error) {
        await this.disposeRuntime(patientId);

        throw error;
      }
    })().finally(() => {
      this.runtimeInitializations.delete(patientId);
    });

    this.runtimeInitializations.set(patientId, runtimeInitialization);
    return runtimeInitialization;
  }

  private async disposeRuntime(patientId: string): Promise<void> {
    const runtime = this.runtimes.get(patientId);
    this.runtimes.delete(patientId);

    if (!runtime) {
      return;
    }

    if ("close" in runtime.client && typeof runtime.client.close === "function") {
      try {
        await runtime.client.close();
      } catch (error) {
        logger.warn({ patientId, error: serializeError(error) }, "failed to close tdlib client during runtime disposal");
      }
    }
  }

  private async resetSessionStorage(patientId: string): Promise<void> {
    const sessionPath = toSessionPath(patientId);

    await this.disposeRuntime(patientId);
    await rm(sessionPath, { recursive: true, force: true });
    this.keyMismatchPatients.delete(patientId);
    this.authKeyDuplicatedPatients.delete(patientId);

    logger.warn({ patientId, sessionPath }, "cleared telegram session storage due to encryption key mismatch");
  }

  private async waitForKeyMismatchSignal(patientId: string, timeoutMs = 500): Promise<boolean> {
    if (this.keyMismatchPatients.has(patientId)) {
      return true;
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));

      if (this.keyMismatchPatients.has(patientId)) {
        return true;
      }
    }

    return false;
  }

  private async ensureAuthenticatedRuntime(patientId: string): Promise<PatientRuntime> {
    if (this.authKeyDuplicatedPatients.has(patientId)) {
      throw new TelegramDomainError(
        "TELEGRAM_AUTH_KEY_DUPLICATED",
        409,
        "Telegram session was opened in another client. Reconnect Telegram and try again",
      );
    }

    const runtime = await this.ensureRuntime(patientId);
    let status: TelegramRuntimeStatus;

    try {
      status = await this.refreshRuntimeState(patientId);
    } catch (error) {
      const mapped = mapTdlibAuthError(error);
      if (mapped?.code === "TELEGRAM_AUTH_KEY_DUPLICATED") {
        await this.markRuntimeExpiredOnAuthKeyDuplication(
          patientId,
          runtime.sessionPath,
          error,
          "telegram.ensure-authenticated-runtime",
        );
        throw mapped;
      }

      if (mapped) {
        throw mapped;
      }

      throw error;
    }

    if (status.authState === "waiting_password") {
      throw new TelegramDomainError(
        "TELEGRAM_2FA_UNSUPPORTED",
        409,
        "Telegram accounts with 2-step password are not supported in this version",
      );
    }

    if (status.authState !== "authenticated") {
      throw new TelegramDomainError("TELEGRAM_NOT_AUTHENTICATED", 409, "Telegram authentication is required");
    }

    return runtime;
  }

  private async refreshRuntimeState(patientId: string): Promise<TelegramRuntimeStatus> {
    const runtime = this.runtimes.get(patientId);
    if (!runtime) {
      return this.getStatus(patientId);
    }

    const authState = (await runtime.client.invoke({
      _: "getAuthorizationState",
    } as any)) as TdObject;

    await this.applyAuthorizationState(runtime, authState);
    return this.serializeRuntime(runtime);
  }

  private async applyAuthorizationState(runtime: PatientRuntime, state: TdObject): Promise<void> {
    const previousAuthState = runtime.authState;
    runtime.authState = mapAuthorizationState(state);

    if (state._ === "authorizationStateReady") {
      const me = (await runtime.client.invoke({
        _: "getMe",
      } as any)) as { id: string | number };

      runtime.telegramUserId = toIdString(me.id);
      runtime.connectedAt = runtime.connectedAt ?? new Date().toISOString();
    } else if (state._ === "authorizationStateClosed" || state._ === "authorizationStateClosing") {
      runtime.telegramUserId = null;
      runtime.connectedAt = null;
    }

    await this.persistRuntime(runtime);
    logger.info(
      {
        operation: "telegram.auth-state",
        patientId: runtime.patientId,
        sessionPath: runtime.sessionPath,
        previousAuthState,
        nextAuthState: runtime.authState,
        telegramUserId: runtime.telegramUserId,
      },
      "telegram authorization state updated",
    );
    telegramSseBroker.publish(runtime.patientId, "auth_state", this.serializeRuntime(runtime));
  }

  private async persistRuntime(runtime: PatientRuntime): Promise<void> {
    await db
      .insert(patientTelegramSession)
      .values({
        patientId: runtime.patientId,
        telegramUserId: runtime.telegramUserId,
        sessionPath: runtime.sessionPath,
        authState: runtime.authState,
        connectedAt: runtime.connectedAt ? new Date(runtime.connectedAt) : null,
      })
      .onConflictDoUpdate({
        target: patientTelegramSession.patientId,
        set: {
          telegramUserId: runtime.telegramUserId,
          sessionPath: runtime.sessionPath,
          authState: runtime.authState,
          connectedAt: runtime.connectedAt ? new Date(runtime.connectedAt) : null,
          updatedAt: new Date(),
        },
      });
  }

  private serializeRuntime(runtime: PatientRuntime): TelegramRuntimeStatus {
    return {
      authState: runtime.authState,
      telegramUserId: runtime.telegramUserId,
      connectedAt: runtime.connectedAt,
      sessionPath: runtime.sessionPath,
    };
  }

  private async resolveContactChat(
    runtime: PatientRuntime,
    contact: PatientContactRecord,
  ): Promise<PatientContactRecord> {
    const telegramPhone = toTelegramPhoneNumber(contact.phoneNumberNormalized);
    const [firstName, ...rest] = contact.name.split(/\s+/);
    const lastName = rest.join(" ");

    let telegramUserId: string | null = contact.telegramUserId;

    if (telegramUserId) {
      try {
        const chat = (await runtime.client.invoke({
          _: "createPrivateChat",
          user_id: toTdlibId(telegramUserId, "user"),
          force: false,
        } as any)) as TdChat;

        return contactService.linkTelegramIdentity(runtime.patientId, contact.id, {
          telegramUserId,
          telegramChatId: String(chat.id),
        });
      } catch (error) {
        if (!isTdlibNotFound(error)) {
          throw error;
        }

        logger.warn(
          {
            patientId: runtime.patientId,
            contactId: contact.id,
            telegramUserId,
            error: serializeError(error),
          },
          "stored telegram user id could not open private chat; re-resolving via phone lookup",
        );
        telegramUserId = null;
      }
    }

    try {
      const imported = (await runtime.client.invoke({
        _: "importContacts",
        contacts: [
          {
            _: "contact",
            phone_number: telegramPhone,
            first_name: firstName || contact.name,
            last_name: lastName,
            vcard: "",
            user_id: 0,
          },
        ],
      } as any)) as { user_ids?: Array<string | number> };

      telegramUserId = toIdString(imported.user_ids?.[0]);
    } catch (error) {
      logger.warn({ error, patientId: runtime.patientId, contactId: contact.id }, "contact import failed");
    }

    if (!telegramUserId) {
      try {
        const user = (await runtime.client.invoke({
          _: "searchUserByPhoneNumber",
          phone_number: telegramPhone,
          only_local: false,
        } as any)) as { id: string | number };

        telegramUserId = toIdString(user.id);
      } catch (error) {
        if (isTdlibNotFound(error)) {
          throw new TelegramDomainError("CONTACT_NOT_ON_TELEGRAM", 404, "Saved contact is not available on Telegram");
        }

        throw error;
      }
    }

    if (!telegramUserId) {
      throw new TelegramDomainError("CONTACT_NOT_ON_TELEGRAM", 404, "Saved contact is not available on Telegram");
    }

    let chat: TdChat;
    try {
      chat = (await runtime.client.invoke({
        _: "createPrivateChat",
        user_id: toTdlibId(telegramUserId, "user"),
        force: false,
      } as any)) as TdChat;
    } catch (error) {
      if (isTdlibNotFound(error)) {
        throw new TelegramDomainError("CONTACT_NOT_ON_TELEGRAM", 404, "Saved contact is not available on Telegram");
      }

      throw error;
    }

    return contactService.linkTelegramIdentity(runtime.patientId, contact.id, {
      telegramUserId,
      telegramChatId: String(chat.id),
    });
  }

  private async fetchChatSummary(
    runtime: PatientRuntime,
    contact: PatientContactRecord,
    chatId: string,
  ): Promise<ChatSummary> {
    const tdlibChatId = toTdlibId(chatId, "chat");

    let chat: TdChat;
    try {
      chat = (await runtime.client.invoke({
        _: "getChat",
        chat_id: tdlibChatId,
      } as any)) as TdChat;
    } catch (error) {
      const mapped = mapTdlibAuthError(error);
      if (mapped?.code === "TELEGRAM_AUTH_KEY_DUPLICATED") {
        await this.markRuntimeExpiredOnAuthKeyDuplication(
          runtime.patientId,
          runtime.sessionPath,
          error,
          "telegram.fetch-chat-summary",
        );
        throw mapped;
      }

      if (mapped) {
        throw mapped;
      }

      throw error;
    }

    return toChatSummary(chat, contact);
  }

  private async markRuntimeExpiredOnAuthKeyDuplication(
    patientId: string,
    sessionPath: string,
    error: unknown,
    operation: string,
  ): Promise<void> {
    const runtime = this.runtimes.get(patientId);
    if (!runtime) {
      return;
    }

    runtime.authState = "expired";
    runtime.telegramUserId = null;
    runtime.connectedAt = null;
    this.authKeyDuplicatedPatients.add(patientId);

    try {
      await this.persistRuntime(runtime);
    } catch (persistError) {
      logger.warn(
        {
          operation,
          patientId,
          sessionPath,
          error: serializeError(persistError),
        },
        "failed to persist telegram auth-state after AUTH_KEY_DUPLICATED",
      );
    }

    telegramSseBroker.publish(patientId, "auth_state", this.serializeRuntime(runtime));

    await this.disposeRuntime(patientId);

    try {
      await rm(sessionPath, { recursive: true, force: true });
    } catch (rmError) {
      logger.warn(
        {
          operation,
          patientId,
          sessionPath,
          error: serializeError(rmError),
        },
        "failed to clear telegram session storage after AUTH_KEY_DUPLICATED",
      );
    }

    logger.warn(
      {
        operation,
        patientId,
        sessionPath,
        error: serializeError(error),
      },
      "telegram session expired due to AUTH_KEY_DUPLICATED; runtime disposed",
    );
  }

  private async handleBackgroundTdlibError(
    patientId: string,
    sessionPath: string,
    error: unknown,
    operation: string,
  ): Promise<void> {
    const mapped = mapTdlibAuthError(error);
    if (mapped?.code === "TELEGRAM_AUTH_KEY_DUPLICATED") {
      await this.markRuntimeExpiredOnAuthKeyDuplication(patientId, sessionPath, error, operation);
      return;
    }

    if (mapped) {
      logger.warn(
        {
          operation,
          patientId,
          sessionPath,
          mappedCode: mapped.code,
          mappedStatus: mapped.status,
          error: serializeError(error),
        },
        "telegram background update produced mapped tdlib error",
      );
      return;
    }

    logger.error(
      {
        operation,
        patientId,
        sessionPath,
        error: serializeError(error),
      },
      "telegram background update handler failed",
    );
  }

  private async handleUpdate(patientId: string, update: TdObject): Promise<void> {
    const runtime = this.runtimes.get(patientId);
    if (!runtime) {
      return;
    }

    switch (update._) {
      case "updateAuthorizationState":
        await this.applyAuthorizationState(runtime, update.authorization_state);
        break;
      case "updateNewMessage":
        await this.handleNewMessage(runtime, update.message as TdMessage);
        break;
      default:
        break;
    }
  }

  private async handleNewMessage(runtime: PatientRuntime, message: TdMessage): Promise<void> {
    const chatId = String(message.chat_id);
    let contact: PatientContactRecord;

    try {
      contact = await contactService.getActiveByChatId(runtime.patientId, chatId);
    } catch (error) {
      if (error instanceof TelegramDomainError && error.code === "CHAT_NOT_ALLOWED") {
        logger.info({ patientId: runtime.patientId, chatId }, "ignored telegram message from non-approved chat");
        return;
      }

      throw error;
    }

    const mapped = toChatMessage(message);
    const chat = await this.fetchChatSummary(runtime, contact, chatId);

    if (!message.is_outgoing && contact.role === "caretaker") {
      try {
        await necessityService.acknowledgeMostRecentPendingByChat(runtime.patientId, chatId);
      } catch (error) {
        logger.error(
          {
            patientId: runtime.patientId,
            chatId,
            error: serializeError(error),
          },
          "failed to acknowledge pending necessity request from incoming caretaker message",
        );
      }
    }

    telegramSseBroker.publish(runtime.patientId, "message_new", {
      chatId,
      message: mapped,
      chat,
    });
  }
}

export const telegramClientManager = new TelegramClientManager();
