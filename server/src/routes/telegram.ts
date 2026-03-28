import { Elysia, t } from "elysia";
import { auth } from "@/lib/auth";
import { logger, serializeError } from "@/lib/logger";
import { contactService } from "@/service/telegram-message/contact-service";
import { isTelegramDomainError } from "@/service/telegram-message/errors";
import { STATIC_REPLY_OPTIONS } from "@/service/telegram-message/reply-options";
import { telegramSchemas } from "@/service/telegram-message/schemas";
import { telegramSseBroker } from "@/service/telegram-message/sse-broker";
import { telegramClientManager } from "@/service/telegram-message/tdlib";

type SessionUser = {
  id: string
};

async function resolveSessionUser(request: Request): Promise<SessionUser | null> {
  const sessionData = await auth.api.getSession({ headers: request.headers });
  return sessionData?.user ? { id: sessionData.user.id } : null;
}

function errorResponse(error: string, message: string) {
  return { error, message };
}

function handleTelegramError(
  set: { status?: number | string },
  error: unknown,
  context?: Record<string, unknown>,
) {
  if (isTelegramDomainError(error)) {
    logger.warn({ ...context, error: serializeError(error) }, "telegram route domain error");
    set.status = error.status;
    return errorResponse(error.code, error.message);
  }

  if (error && typeof error === "object") {
    const rawCode = "code" in error ? (error as { code?: unknown }).code : undefined;
    const code = typeof rawCode === "number" ? rawCode : Number(rawCode);
    const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";

    if (code === 406 && message.includes("AUTH_KEY_DUPLICATED")) {
      set.status = 409;
      return errorResponse(
        "TELEGRAM_AUTH_KEY_DUPLICATED",
        "Telegram session was opened in another client. Reconnect Telegram and try again",
      );
    }
  }

  logger.error({ ...context, error: serializeError(error) }, "telegram route failed");
  set.status = 500;
  return errorResponse("INTERNAL_SERVER_ERROR", "Telegram operation failed");
}

function formatSseChunk(type: string, data: unknown): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const telegramRoutes = new Elysia({
  prefix: "/telegram",
  detail: {
    tags: ["Telegram"],
  },
})
  .get(
    "/auth/status",
    async ({ request, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      try {
        return await telegramClientManager.getStatus(user.id);
      } catch (error) {
        return handleTelegramError(set, error);
      }
    },
    {
      response: {
        200: telegramSchemas.authStatus,
        401: telegramSchemas.error,
        400: telegramSchemas.error,
        429: telegramSchemas.error,
        503: telegramSchemas.error,
        409: telegramSchemas.error,
        500: telegramSchemas.error,
      },
    },
  )
  .post(
    "/auth/start",
    async ({ request, body, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      try {
        return await telegramClientManager.startAuthentication(user.id, body.phoneNumber);
      } catch (error) {
        return handleTelegramError(set, error, {
          operation: "auth.start",
          patientId: user.id,
          phoneNumberLength: body.phoneNumber.length,
        });
      }
    },
    {
      body: telegramSchemas.authStartBody,
      response: {
        200: telegramSchemas.authStatus,
        401: telegramSchemas.error,
        400: telegramSchemas.error,
        429: telegramSchemas.error,
        503: telegramSchemas.error,
        409: telegramSchemas.error,
        500: telegramSchemas.error,
      },
    },
  )
  .post(
    "/auth/verify-code",
    async ({ request, body, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      try {
        return await telegramClientManager.verifyCode(user.id, body.code);
      } catch (error) {
        return handleTelegramError(set, error, {
          operation: "auth.verify-code",
          patientId: user.id,
          codeLength: body.code.length,
        });
      }
    },
    {
      body: telegramSchemas.authVerifyCodeBody,
      response: {
        200: telegramSchemas.authStatus,
        401: telegramSchemas.error,
        409: telegramSchemas.error,
        500: telegramSchemas.error,
      },
    },
  )
  .get(
    "/contacts",
    async ({ request, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      try {
        return await contactService.list(user.id);
      } catch (error) {
        return handleTelegramError(set, error);
      }
    },
    {
      response: {
        200: t.Array(telegramSchemas.contact),
        401: telegramSchemas.error,
        500: telegramSchemas.error,
      },
    },
  )
  .post(
    "/contacts",
    async ({ request, body, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      try {
        const contact = await contactService.create(user.id, body);
        telegramSseBroker.publish(user.id, "contact_updated", { action: "created", contact });
        return contact;
      } catch (error) {
        return handleTelegramError(set, error);
      }
    },
    {
      body: telegramSchemas.contactCreateBody,
      response: {
        200: telegramSchemas.contact,
        401: telegramSchemas.error,
        409: telegramSchemas.error,
        500: telegramSchemas.error,
      },
    },
  )
  .patch(
    "/contacts/:contactId",
    async ({ request, params, body, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      try {
        const contact = await contactService.update(user.id, params.contactId, body);
        telegramSseBroker.publish(user.id, "contact_updated", { action: "updated", contact });
        return contact;
      } catch (error) {
        return handleTelegramError(set, error);
      }
    },
    {
      params: t.Object({
        contactId: t.String(),
      }),
      body: telegramSchemas.contactUpdateBody,
      response: {
        200: telegramSchemas.contact,
        401: telegramSchemas.error,
        404: telegramSchemas.error,
        409: telegramSchemas.error,
        500: telegramSchemas.error,
      },
    },
  )
  .delete(
    "/contacts/:contactId",
    async ({ request, params, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      try {
        await contactService.delete(user.id, params.contactId);
        telegramSseBroker.publish(user.id, "contact_updated", {
          action: "deleted",
          contactId: params.contactId,
        });
        return { ok: true };
      } catch (error) {
        return handleTelegramError(set, error);
      }
    },
    {
      params: t.Object({
        contactId: t.String(),
      }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: telegramSchemas.error,
        404: telegramSchemas.error,
        500: telegramSchemas.error,
      },
    },
  )
  .post(
    "/contacts/:contactId/open-chat",
    async ({ request, params, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      try {
        return await telegramClientManager.openChat(user.id, params.contactId);
      } catch (error) {
        return handleTelegramError(set, error);
      }
    },
    {
      params: t.Object({
        contactId: t.String(),
      }),
      response: {
        200: telegramSchemas.openChatResponse,
        401: telegramSchemas.error,
        404: telegramSchemas.error,
        409: telegramSchemas.error,
        500: telegramSchemas.error,
      },
    },
  )
  .get(
    "/chats",
    async ({ request, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      try {
        return await telegramClientManager.listChats(user.id);
      } catch (error) {
        return handleTelegramError(set, error);
      }
    },
    {
      response: {
        200: t.Array(telegramSchemas.chat),
        401: telegramSchemas.error,
        409: telegramSchemas.error,
        500: telegramSchemas.error,
      },
    },
  )
  .get(
    "/chats/:chatId/messages",
    async ({ request, params, query, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      const limit = query.limit ? Number(query.limit) : 100;
      const fromMessageId = query.fromMessageId || undefined;

      try {
        return await telegramClientManager.getMessages(user.id, params.chatId, limit, fromMessageId);
      } catch (error) {
        return handleTelegramError(set, error);
      }
    },
    {
      params: t.Object({
        chatId: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.String()),
        fromMessageId: t.Optional(t.String()),
      }),
      response: {
        200: t.Array(telegramSchemas.message),
        401: telegramSchemas.error,
        404: telegramSchemas.error,
        409: telegramSchemas.error,
        500: telegramSchemas.error,
      },
    },
  )
  .post(
    "/chats/:chatId/messages",
    async ({ request, params, body, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      try {
        return await telegramClientManager.sendMessage(user.id, params.chatId, body.text);
      } catch (error) {
        return handleTelegramError(set, error);
      }
    },
    {
      params: t.Object({
        chatId: t.String(),
      }),
      body: telegramSchemas.sendMessageBody,
      response: {
        200: telegramSchemas.message,
        401: telegramSchemas.error,
        404: telegramSchemas.error,
        409: telegramSchemas.error,
        500: telegramSchemas.error,
      },
    },
  )
  .get(
    "/chats/:chatId/reply-options",
    async ({ request, params, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      try {
        await contactService.getActiveByChatId(user.id, params.chatId);
        return STATIC_REPLY_OPTIONS;
      } catch (error) {
        return handleTelegramError(set, error);
      }
    },
    {
      params: t.Object({
        chatId: t.String(),
      }),
      response: {
        200: t.Array(telegramSchemas.replyOption),
        401: telegramSchemas.error,
        404: telegramSchemas.error,
        500: telegramSchemas.error,
      },
    },
  )
  .get("/events", async ({ request }) => {
    const user = await resolveSessionUser(request);
    if (!user) {
      return new Response(JSON.stringify(errorResponse("UNAUTHORIZED", "Sign in required")), {
        status: 401,
        headers: {
          "content-type": "application/json",
        },
      });
    }

    const initialStatus = await telegramClientManager.getStatus(user.id);

    return new Response(
      new ReadableStream({
        start(controller) {
          const send = (type: string, data: unknown) => {
            controller.enqueue(formatSseChunk(type, data));
          };

          const unsubscribe = telegramSseBroker.subscribe(user.id, (event) => {
            send(event.type, event.data);
          });

          const heartbeat = setInterval(() => {
            send("heartbeat", { timestamp: new Date().toISOString() });
          }, 15000);

          const cleanup = () => {
            clearInterval(heartbeat);
            unsubscribe();
            try {
              controller.close();
            } catch {
              // Stream is already closed.
            }
          };

          request.signal.addEventListener("abort", cleanup, { once: true });
          send("ready", initialStatus);
        },
      }),
      {
        headers: {
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "content-type": "text/event-stream",
        },
      },
    );
  });
