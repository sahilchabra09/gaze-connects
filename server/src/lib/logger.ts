import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
});

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const base: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };

    for (const [key, value] of Object.entries(error)) {
      base[key] = value;
    }

    return base;
  }

  if (error && typeof error === "object") {
    return { ...(error as Record<string, unknown>) };
  }

  return { value: error };
}
