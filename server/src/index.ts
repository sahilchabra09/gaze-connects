import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";
import { createAuthPlugin } from "./lib/middleware";
import { logger, serializeError } from "./lib/logger";
import { necessityRoutes } from "./routes/necessity";
import { gazeRoutes } from "./routes/gaze";
import { applianceRoutes } from "./routes/appliance";
import { telegramRoutes } from "./routes/telegram";
import { voiceAgentRoutes } from "./routes/voice-agent";
import { userRoutes } from "./routes/user";
import { talkRoutes } from "./routes/talk";
import { necessityService } from "./service/necessity/service";

/**
 * GazeCore Backend - Main Server
 * Route-first architecture
 */
const host = process.env.HOST ?? "0.0.0.0"
const port = Number(process.env.PORT ?? 8000)

const app = new Elysia()
  .use(
    swagger({
      path: "/docs",
      documentation: {
        info: {
          title: "GazeConnect Server",
          version: "1.0.0",
          description: "Auth-ready server with Better Auth routes and user endpoints",
        },
      },
    })
  )
  .onAfterHandle(({ request, response, set }) => {
    const url = new URL(request.url)
    const status = response instanceof Response
      ? response.status
      : typeof set.status === "number"
        ? set.status
        : 200

    logger.info({ method: request.method, path: url.pathname, status }, "request completed")
  })
  .onError(({ request, error, set }) => {
    const url = new URL(request.url)
    const status = typeof set.status === "number" ? set.status : 500

    logger.error({ error, method: request.method, path: url.pathname, status }, "request failed")
  })
  // Auth middleware (CORS + auth derive)
  .use(createAuthPlugin())
  // Root endpoint
  .get("/", () => ({
    message: "GazeCore Backend API",
    version: "1.0.0",
    status: "running",
  }))
  // Health check
  .get("/health", () => ({
    status: "healthy",
    timestamp: new Date().toISOString(),
  }))
  // API routes grouped under /api
  .group("/api", (app) =>
    app
      // Better Auth endpoints are mounted by middleware at /api/auth/*
      // User routes: /api/users/me, /api/users/:id
      .use(applianceRoutes)
      .use(gazeRoutes)
      .use(necessityRoutes)
      .use(telegramRoutes)
      .use(voiceAgentRoutes)
        .use(talkRoutes)
      .use(userRoutes)
  )
  .listen({
    hostname: host,
    port,
  });

logger.info(
  {
    baseUrl: `http://${host}:${port}`,
    authBase: `http://${host}:${port}/api/auth`,
    docsUrl: `http://${host}:${port}/docs`,
  },
  "GazeConnect server started"
)

void necessityService.initialize().catch((error) => {
  logger.warn(
    {
      error: serializeError(error),
    },
    "necessity service initialization skipped; server will continue running",
  );
})
