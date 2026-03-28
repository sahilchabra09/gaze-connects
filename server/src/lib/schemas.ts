import { t } from "elysia";

/**
 * Authentication validation schemas for request/response bodies
 */
export const authSchemas = {
  user: t.Object({
    id: t.String(),
    email: t.String({ format: "email" }),
    name: t.String(),
    image: t.Union([t.String(), t.Null()]),
    emailVerified: t.Boolean(),
    createdAt: t.String({ format: "date-time" }),
  }),

  error: t.Object({
    error: t.String(),
    message: t.String(),
  }),
} as const;
