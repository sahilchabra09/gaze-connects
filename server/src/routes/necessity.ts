import { Elysia, t } from "elysia";
import { auth } from "@/lib/auth";
import { logger, serializeError } from "@/lib/logger";
import { telegramClientManager } from "@/service/telegram-message/tdlib";
import { isTelegramDomainError } from "@/service/telegram-message/errors";
import { isNecessityDomainError } from "@/service/necessity/errors";
import { necessitySchemas } from "@/service/necessity/schemas";
import { necessityService } from "@/service/necessity/service";

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

function handleNecessityError(
  set: { status?: number | string },
  error: unknown,
  context?: Record<string, unknown>,
) {
  if (isNecessityDomainError(error)) {
    set.status = error.status;
    return errorResponse(error.code, error.message);
  }

  if (isTelegramDomainError(error)) {
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

  logger.error({ ...context, error: serializeError(error) }, "necessity route failed");
  set.status = 500;
  return errorResponse("INTERNAL_SERVER_ERROR", "Necessity operation failed");
}

export const necessityRoutes = new Elysia({
  prefix: "/necessities",
  detail: {
    tags: ["Necessities"],
  },
})
  .get(
    "/",
    async ({ request, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      try {
        return await necessityService.list(user.id);
      } catch (error) {
        return handleNecessityError(set, error, { operation: "necessities.list", patientId: user.id });
      }
    },
    {
      response: {
        200: t.Array(necessitySchemas.necessity),
        401: necessitySchemas.error,
        500: necessitySchemas.error,
      },
    },
  )
  .get(
    "/active",
    async ({ request, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      try {
        return await necessityService.listActive(user.id);
      } catch (error) {
        return handleNecessityError(set, error, { operation: "necessities.list-active", patientId: user.id });
      }
    },
    {
      response: {
        200: t.Array(necessitySchemas.necessity),
        401: necessitySchemas.error,
        500: necessitySchemas.error,
      },
    },
  )
  .post(
    "/",
    async ({ request, body, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      try {
        return await necessityService.create(user.id, body);
      } catch (error) {
        return handleNecessityError(set, error, { operation: "necessities.create", patientId: user.id });
      }
    },
    {
      body: necessitySchemas.createBody,
      response: {
        200: necessitySchemas.necessity,
        400: necessitySchemas.error,
        401: necessitySchemas.error,
        500: necessitySchemas.error,
      },
    },
  )
  .patch(
    "/:necessityId",
    async ({ request, params, body, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      try {
        return await necessityService.update(user.id, params.necessityId, body);
      } catch (error) {
        return handleNecessityError(set, error, {
          operation: "necessities.update",
          patientId: user.id,
          necessityId: params.necessityId,
        });
      }
    },
    {
      params: t.Object({
        necessityId: t.String(),
      }),
      body: necessitySchemas.updateBody,
      response: {
        200: necessitySchemas.necessity,
        400: necessitySchemas.error,
        401: necessitySchemas.error,
        404: necessitySchemas.error,
        500: necessitySchemas.error,
      },
    },
  )
  .post(
    "/:necessityId/trigger",
    async ({ request, params, set }) => {
      const user = await resolveSessionUser(request);
      if (!user) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      try {
        return await necessityService.trigger(user.id, params.necessityId, {
          sendTelegramMessage: (chatId, text) => telegramClientManager.sendMessage(user.id, chatId, text),
        });
      } catch (error) {
        return handleNecessityError(set, error, {
          operation: "necessities.trigger",
          patientId: user.id,
          necessityId: params.necessityId,
        });
      }
    },
    {
      params: t.Object({
        necessityId: t.String(),
      }),
      response: {
        200: necessitySchemas.triggerResponse,
        401: necessitySchemas.error,
        404: necessitySchemas.error,
        409: necessitySchemas.error,
        500: necessitySchemas.error,
      },
    },
  );
