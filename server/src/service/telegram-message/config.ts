import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { TelegramConfig } from "./types";

function parseRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseApiId(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("TELEGRAM_API_ID must be a positive integer");
  }

  return parsed;
}

function loadTelegramConfig(): TelegramConfig {
  const sessionsDir = resolve(process.env.TDLIB_SESSIONS_DIR?.trim() || "./tdlib-sessions");

  return {
    apiId: parseApiId(parseRequiredEnv("TELEGRAM_API_ID")),
    apiHash: parseRequiredEnv("TELEGRAM_API_HASH"),
    encryptionKey: parseRequiredEnv("TDLIB_ENCRYPTION_KEY"),
    sessionsDir,
  };
}

export const telegramConfig = loadTelegramConfig();

export async function ensureTelegramStorage(): Promise<void> {
  await mkdir(telegramConfig.sessionsDir, { recursive: true });
}
