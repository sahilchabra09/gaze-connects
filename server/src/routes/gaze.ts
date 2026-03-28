import { and, eq, gt, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db";
import { session, user } from "../db/schema";
import { auth } from "../lib/auth";
import { logger } from "../lib/logger";
import { deriveStableUuidFromEmail, normalizeEmailForUuid, resolveUuidSecret } from "../lib/uuid";
import type {
  GazeCoreGyroSnapshotResponse,
  GazeCoreGyroSnapshotResponseCandidate,
  GazeCoreTokenResponse,
  GazeCoreTokenResponseCandidate,
  UpstreamErrorPayload,
} from "../types/gaze";

const validateUuidBody = t.Object({
  email: t.Optional(t.String({ format: "email" })),
  token: t.Optional(t.String({ minLength: 1 })),
  password: t.Optional(t.String({ minLength: 1 })),
});

const proxyTokenBody = t.Optional(t.Object({}, { additionalProperties: true }));

const validateUuidResponse = t.Object({
  email: t.String({ format: "email" }),
  uuid: t.String(),
  hashed_uuid: t.String(),
});

const tokenResponse = t.Object({
  token: t.String({ minLength: 1 }),
  uuid: t.String({ minLength: 1 }),
  expiresAt: t.String({ minLength: 1 }),
  expiresInSeconds: t.Number(),
  websocketUrl: t.Optional(t.String({ minLength: 1 })),
});

const gyroSnapshotResponse = t.Object({
  uuid: t.String({ minLength: 1 }),
  snapshot: t.Any(),
});

const errorResponse = t.Object({
  error: t.String(),
  message: t.String(),
});

class GazeProxyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "GazeProxyError";
  }
}

function parseToken(rawToken: string | null | undefined) {
  const trimmed = rawToken?.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.toLowerCase().startsWith("bearer ")) {
    const bearerToken = trimmed.slice("bearer ".length).trim();
    return bearerToken || null;
  }

  return trimmed;
}

function resolveGazeCoreBaseUrl() {
  const configuredBaseUrl = process.env.GAZECORE_BACKEND_URL?.trim();
  return (configuredBaseUrl || "http://localhost:3000").replace(/\/+$/g, "");
}

function resolveGazeCoreApiKey() {
  const apiKey = process.env.GAZECORE_API_KEY?.trim();
  if (!apiKey) {
    throw new GazeProxyError(
      500,
      "CONFIGURATION_ERROR",
      "GAZECORE_API_KEY is not configured in this backend environment."
    );
  }

  return apiKey;
}

function buildGazeCoreRouteUrl(routePath: string) {
  return new URL(routePath, `${resolveGazeCoreBaseUrl()}/`).toString();
}

function normalizeProxyErrorPayload(payload: unknown, fallbackCode: string, fallbackMessage: string) {
  if (!payload || typeof payload !== "object") {
    return {
      code: fallbackCode,
      message: fallbackMessage,
    };
  }

  const record = payload as UpstreamErrorPayload;
  return {
    code: typeof record.error === "string" && record.error.trim() ? record.error : fallbackCode,
    message: typeof record.message === "string" && record.message.trim() ? record.message : fallbackMessage,
  };
}

function isGazeCoreTokenResponse(payload: unknown): payload is GazeCoreTokenResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as GazeCoreTokenResponseCandidate;
  return (
    typeof candidate.token === "string" &&
    typeof candidate.uuid === "string" &&
    typeof candidate.expiresAt === "string" &&
    typeof candidate.expiresInSeconds === "number" &&
    (candidate.websocketUrl === undefined || typeof candidate.websocketUrl === "string")
  );
}

function isGazeCoreGyroSnapshotResponse(payload: unknown): payload is GazeCoreGyroSnapshotResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as GazeCoreGyroSnapshotResponseCandidate;
  return typeof candidate.uuid === "string" && "snapshot" in candidate;
}

async function readJsonSafely(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function resolveEmailFromSessionToken(token: string) {
  const activeSession = await db
    .select({
      email: user.email,
    })
    .from(session)
    .innerJoin(user, eq(session.userId, user.id))
    .where(and(eq(session.token, token), gt(session.expiresAt, new Date())))
    .limit(1);

  const sessionOwner = activeSession[0];
  return sessionOwner ? normalizeEmailForUuid(sessionOwner.email) : null;
}

async function resolveEmailFromRequestAuth(request: Request, explicitToken?: string | null) {
  const directToken = explicitToken ?? parseToken(request.headers.get("authorization"));
  if (directToken) {
    const sessionEmail = await resolveEmailFromSessionToken(directToken);
    if (sessionEmail) {
      return sessionEmail;
    }
  }

  try {
    const sessionData = await auth.api.getSession({ headers: request.headers });
    return sessionData?.user?.email ? normalizeEmailForUuid(sessionData.user.email) : null;
  } catch {
    return null;
  }
}

function deriveUuidFromEmailOrThrow(email: string) {
  const uuidSecret = resolveUuidSecret();
  if (!uuidSecret) {
    throw new GazeProxyError(
      500,
      "CONFIGURATION_ERROR",
      "UUID key is not configured. Set GAZE_UUID_ENCRYPTION_KEY or UUID_ENCRYPTION_KEY in the backend environment."
    );
  }

  return deriveStableUuidFromEmail(email, uuidSecret);
}

async function requestGazeCoreToken(uuid: string): Promise<GazeCoreTokenResponse> {
  const apiKey = resolveGazeCoreApiKey();

  const response = await fetch(buildGazeCoreRouteUrl("/api/gaze/token"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apiKey,
      metadata: {
        uuid,
      },
    }),
  });

  const payload = await readJsonSafely(response);
  if (!response.ok) {
    const error = normalizeProxyErrorPayload(
      payload,
      "GAZECORE_TOKEN_ISSUE_FAILED",
      "Unable to issue gaze token from GazeCore."
    );
    throw new GazeProxyError(response.status, error.code, error.message);
  }

  if (!isGazeCoreTokenResponse(payload)) {
    throw new GazeProxyError(
      502,
      "INVALID_UPSTREAM_RESPONSE",
      "GazeCore token response is invalid."
    );
  }

  return payload;
}

async function requestGazeCoreGyroSnapshot(token: string): Promise<GazeCoreGyroSnapshotResponse> {
  const response = await fetch(buildGazeCoreRouteUrl("/api/gaze/gyro-snapshot"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await readJsonSafely(response);
  if (!response.ok) {
    const error = normalizeProxyErrorPayload(
      payload,
      "GAZECORE_GYRO_SNAPSHOT_FAILED",
      "Unable to capture gyro snapshot from GazeCore."
    );
    throw new GazeProxyError(response.status, error.code, error.message);
  }

  if (!isGazeCoreGyroSnapshotResponse(payload)) {
    throw new GazeProxyError(
      502,
      "INVALID_UPSTREAM_RESPONSE",
      "GazeCore snapshot response is invalid."
    );
  }

  return payload;
}

async function findUserByEmail(email: string) {
  const existingUsers = await db
    .select({
      email: user.email,
      hardwarePasswordHash: user.hardwarePasswordHash,
    })
    .from(user)
    .where(sql`lower(${user.email}) = ${email}`)
    .limit(1);

  return existingUsers[0] ?? null;
}

export const gazeRoutes = new Elysia({
  prefix: "/gaze",
  detail: {
    tags: ["Gaze"],
  },
})
  .post(
    "/validate/uuid",
    async ({ body, request, set }) => {
      const requestedEmail = body.email ? normalizeEmailForUuid(body.email) : null;
      const requestedPassword = body.password?.trim();
      const requestedToken = parseToken(body.token) ?? parseToken(request.headers.get("authorization"));

      // ESP mode: email + password must match the stored hardware password hash.
      if (requestedPassword) {
        if (!requestedEmail) {
          set.status = 400;
          return {
            error: "VALIDATION_ERROR",
            message: "Email is required when password is provided.",
          };
        }

        const matchedUser = await findUserByEmail(requestedEmail);
        if (!matchedUser) {
          set.status = 404;
          return {
            error: "NOT_FOUND",
            message: "User not found.",
          };
        }

        if (!matchedUser.hardwarePasswordHash) {
          set.status = 403;
          return {
            error: "HARDWARE_PASSWORD_NOT_SET",
            message: "No hardware password is configured for this user.",
          };
        }

        const passwordMatches = await Bun.password.verify(requestedPassword, matchedUser.hardwarePasswordHash);
        if (!passwordMatches) {
          set.status = 401;
          return {
            error: "INVALID_CREDENTIALS",
            message: "Invalid hardware password.",
          };
        }

        try {
          const uuid = deriveUuidFromEmailOrThrow(matchedUser.email);
          return {
            email: normalizeEmailForUuid(matchedUser.email),
            uuid,
            hashed_uuid: uuid,
          };
        } catch (error) {
          if (error instanceof GazeProxyError) {
            set.status = error.status;
            return {
              error: error.code,
              message: error.message,
            };
          }

          logger.error({ error }, "Failed to derive UUID in hardware password mode");
          set.status = 500;
          return {
            error: "UUID_DERIVATION_FAILED",
            message: "Unable to derive UUID for this user.",
          };
        }
      }

      const resolvedEmail = await resolveEmailFromRequestAuth(request, requestedToken);
      if (!resolvedEmail) {
        set.status = 401;
        return {
          error: "UNAUTHORIZED",
          message: "Provide a valid Better Auth session token or email + password.",
        };
      }

      try {
        const uuid = deriveUuidFromEmailOrThrow(resolvedEmail);
        return {
          email: resolvedEmail,
          uuid,
          hashed_uuid: uuid,
        };
      } catch (error) {
        if (error instanceof GazeProxyError) {
          set.status = error.status;
          return {
            error: error.code,
            message: error.message,
          };
        }

        logger.error({ error }, "Failed to derive UUID in auth token mode");
        set.status = 500;
        return {
          error: "UUID_DERIVATION_FAILED",
          message: "Unable to derive UUID for this user.",
        };
      }
    },
    {
      body: validateUuidBody,
      response: {
        200: validateUuidResponse,
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        500: errorResponse,
      },
    }
  )
  .post(
    "/token",
    async ({ request, set }) => {
      try {
        const resolvedEmail = await resolveEmailFromRequestAuth(request);
        if (!resolvedEmail) {
          set.status = 401;
          return {
            error: "UNAUTHORIZED",
            message: "A valid Better Auth token or active session is required.",
          };
        }

        const uuid = deriveUuidFromEmailOrThrow(resolvedEmail);
        const tokenPayload = await requestGazeCoreToken(uuid);
        return tokenPayload;
      } catch (error) {
        if (error instanceof GazeProxyError) {
          set.status = error.status;
          return {
            error: error.code,
            message: error.message,
          };
        }

        logger.error({ error }, "Failed to issue proxied gaze token");
        set.status = 500;
        return {
          error: "GAZE_TOKEN_PROXY_FAILED",
          message: "Unable to issue gaze token through proxy.",
        };
      }
    },
    {
      body: proxyTokenBody,
      response: {
        200: tokenResponse,
        401: errorResponse,
        500: errorResponse,
        502: errorResponse,
      },
    }
  )
  .post(
    "/gyro-snapshot",
    async ({ request, set }) => {
      try {
        const incomingAuthorizationToken = parseToken(request.headers.get("authorization"));
        const sessionEmail = await resolveEmailFromRequestAuth(request, incomingAuthorizationToken);

        let gazeToken = incomingAuthorizationToken;
        if (sessionEmail) {
          const uuid = deriveUuidFromEmailOrThrow(sessionEmail);
          const issuedToken = await requestGazeCoreToken(uuid);
          gazeToken = issuedToken.token;
        }

        if (!gazeToken) {
          set.status = 401;
          return {
            error: "UNAUTHORIZED",
            message: "Provide either a Better Auth token/session or a valid gaze access token.",
          };
        }

        const snapshotPayload = await requestGazeCoreGyroSnapshot(gazeToken);
        return snapshotPayload;
      } catch (error) {
        if (error instanceof GazeProxyError) {
          set.status = error.status;
          return {
            error: error.code,
            message: error.message,
          };
        }

        logger.error({ error }, "Failed to capture proxied gyro snapshot");
        set.status = 500;
        return {
          error: "GAZE_GYRO_PROXY_FAILED",
          message: "Unable to capture gyro snapshot through proxy.",
        };
      }
    },
    {
      response: {
        200: gyroSnapshotResponse,
        401: errorResponse,
        500: errorResponse,
        502: errorResponse,
      },
    }
  );
