import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";
import { createAuthPlugin } from "./lib/middleware";
import { logger } from "./lib/logger";
import { gazeRoutes } from "./routes/gaze";
import { telegramRoutes } from "./routes/telegram";
import { userRoutes } from "./routes/user";
import { telegramClientManager } from "./service/telegram-message/tdlib";

/**
 * GazeCore Backend - Main Server
 * Route-first architecture
 */
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
      .use(gazeRoutes)
      .use(telegramRoutes)
      .use(userRoutes)
  )
  .listen(8000);

logger.info(
  {
    baseUrl: "http://localhost:8000",
    authBase: "http://localhost:8000/api/auth",
    docsUrl: "http://localhost:8000/docs",
  },
  "GazeConnect server started"
)

void telegramClientManager.initialize().then(() => {
  logger.info("telegram client manager initialized")
}).catch((error) => {
  logger.error({ error }, "telegram client manager failed to initialize")
})
