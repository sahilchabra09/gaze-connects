import { Elysia, t } from "elysia";
import { generateObject, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { logger } from "../lib/logger";

const MAX_HISTORY_BATCHES = 5;

const optionsRequestSchema = t.Object({
  message: t.String({ minLength: 1 }),
});

const optionsResponseSchema = t.Object({
  options: t.Array(t.String({ minLength: 1 }), { minItems: 4, maxItems: 4 }),
  recentHistory: t.Array(t.Array(t.String({ minLength: 1 }))),
});

const transcribeResponseSchema = t.Object({
  text: t.String(),
});

const errorResponseSchema = t.Object({
  error: t.String(),
  message: t.String(),
});

const SYSTEM_PROMPT = [
  "You assist patients communicating with eye-tracking and limited mobility.",
  "Given an incoming message, produce four empathetic and conversational reply options.",
  "Rules:",
  "- Return JSON only.",
  "- Return exactly an array of four strings.",
  "- Each option must be <= 40 words.",
  "- Avoid repeating recent suggestions provided in the context.",
  "- Keep tone warm, practical, and respectful.",
].join("\n");

const responseHistory: string[][] = [];

type TranscriptionResponse = {
  text?: string;
  error?: {
    message?: string;
  };
};

class TalkRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TalkRouteError";
  }
}

function getGroqApiKeys() {
  const keys = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_ALT_1,
    process.env.GROQ_API_KEY_ALT_2,
    process.env.GROQ_API_KEY_ALT_3,
    process.env.GROQ_API_KEY_ALT_4,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  if (keys.length === 0) {
    throw new TalkRouteError(
      500,
      "MISSING_GROQ_KEY",
      "No Groq API key is configured on the server.",
    );
  }

  return keys;
}

function resolveChatModel() {
  return process.env.GROQ_CHAT_MODEL?.trim() || "llama-3.3-70b-versatile";
}

function resolveTranscriptionModel() {
  return process.env.GROQ_TRANSCRIPTION_MODEL?.trim() || "whisper-large-v3";
}

function snapshotHistory() {
  return responseHistory.map((batch) => [...batch]);
}

function pushHistory(options: string[]) {
  responseHistory.push([...options]);
  if (responseHistory.length > MAX_HISTORY_BATCHES) {
    responseHistory.splice(0, responseHistory.length - MAX_HISTORY_BATCHES);
  }
}

function buildUserPrompt(message: string, history: string[][]) {
  const cleaned = message.trim();
  const flattened = history.flat().map((value) => value.trim()).filter(Boolean);
  const historySection = flattened.length
    ? `Previously suggested options to avoid repeating:\n${flattened.map((value) => `- ${value}`).join("\n")}\n\n`
    : "";

  return `${historySection}Incoming message:\n"""\n${cleaned}\n"""\nGenerate four fresh reply options.`;
}

function normalizeOptions(candidateOptions: string[]) {
  const normalized = candidateOptions.map((value) => value.trim()).filter(Boolean);
  if (normalized.length !== 4) {
    throw new TalkRouteError(502, "INVALID_MODEL_OUTPUT", "Model did not return exactly four options.");
  }

  return normalized;
}

function parseOptionsFromText(rawText: string) {
  const trimmed = rawText.trim();

  const jsonBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const rawJsonCandidate = jsonBlockMatch?.[1]?.trim() || trimmed;

  try {
    const parsed = JSON.parse(rawJsonCandidate) as unknown;

    if (Array.isArray(parsed)) {
      if (!parsed.every((value) => typeof value === "string")) {
        throw new TalkRouteError(502, "INVALID_MODEL_OUTPUT", "Model JSON array includes non-string values.");
      }

      return normalizeOptions(parsed as string[]);
    }

    if (parsed && typeof parsed === "object" && "options" in parsed) {
      const options = (parsed as { options?: unknown }).options;
      if (!Array.isArray(options) || !options.every((value) => typeof value === "string")) {
        throw new TalkRouteError(502, "INVALID_MODEL_OUTPUT", "Model options object is invalid.");
      }

      return normalizeOptions(options as string[]);
    }
  } catch {
    // Continue with plain-text fallback parsing.
  }

  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/^[-*•]\s*/, "")
        .replace(/^\d+[.):\-]\s*/, "")
        .replace(/^option\s*[a-d1-4]\s*[:.)\-]?\s*/i, "")
        .trim(),
    )
    .filter(Boolean);

  return normalizeOptions(lines.slice(0, 4));
}

async function requestChatOptions(message: string) {
  const keys = getGroqApiKeys();
  const history = snapshotHistory();
  const userPrompt = buildUserPrompt(message, history);

  const optionsSchema = z.object({
    options: z.array(z.string().min(1)).length(4),
  });

  for (const key of keys) {
    try {
      const groq = createOpenAI({
        apiKey: key,
        baseURL: "https://api.groq.com/openai/v1",
      });

      let options: string[];

      try {
        const { object } = await generateObject({
          model: groq(resolveChatModel()),
          schema: optionsSchema,
          system: SYSTEM_PROMPT,
          prompt: userPrompt,
          temperature: 0.75,
          maxOutputTokens: 512,
        });

        options = normalizeOptions(object.options);
      } catch (structuredError) {
        logger.warn(
          {
            keySuffix: key.slice(-6),
            error: structuredError,
          },
          "talk options structured generation failed; trying text fallback",
        );

        const { text } = await generateText({
          model: groq(resolveChatModel()),
          system: SYSTEM_PROMPT,
          prompt: `${userPrompt}\nReturn JSON array of exactly four strings.`,
          temperature: 0.75,
          maxOutputTokens: 512,
        });

        options = parseOptionsFromText(text);
      }

      pushHistory(options);
      logger.info({ keySuffix: key.slice(-6) }, "talk options generated");

      return {
        options,
        recentHistory: snapshotHistory(),
      };
    } catch (error) {
      logger.warn(
        {
          keySuffix: key.slice(-6),
          error,
        },
        "talk options request error",
      );
      continue;
    }
  }

  throw new TalkRouteError(502, "GROQ_REQUEST_FAILED", "Unable to generate talk options right now.");
}

async function requestTranscription(file: File) {
  const keys = getGroqApiKeys();
  const fileBuffer = await file.arrayBuffer();

  for (const key of keys) {
    try {
      const form = new FormData();
      form.append(
        "file",
        new Blob([fileBuffer], { type: file.type || "audio/webm" }),
        file.name || `recording-${Date.now()}.webm`,
      );
      form.append("model", resolveTranscriptionModel());
      form.append("response_format", "json");

      const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
        },
        body: form,
      });

      const payload = (await response.json().catch(() => null)) as TranscriptionResponse | null;
      if (!response.ok) {
        const messageFromProvider = payload?.error?.message || "Groq transcription failed.";
        logger.warn(
          {
            status: response.status,
            keySuffix: key.slice(-6),
            message: messageFromProvider,
          },
          "talk transcription request failed",
        );
        continue;
      }

      const text = payload?.text?.trim() ?? "";
      if (!text) {
        throw new TalkRouteError(502, "EMPTY_TRANSCRIPTION", "No text returned from transcription service.");
      }

      logger.info({ keySuffix: key.slice(-6) }, "talk transcription generated");
      return text;
    } catch (error) {
      logger.warn(
        {
          keySuffix: key.slice(-6),
          error,
        },
        "talk transcription request error",
      );
      continue;
    }
  }

  throw new TalkRouteError(502, "GROQ_REQUEST_FAILED", "Unable to transcribe audio right now.");
}

export const talkRoutes = new Elysia({
  prefix: "/talk",
  detail: {
    tags: ["Talk"],
  },
})
  .post(
    "/transcribe",
    async ({ request, set }) => {
      try {
        const formData = await request.formData();
        const file = formData.get("file");

        if (!(file instanceof File)) {
          set.status = 400;
          return {
            error: "VALIDATION_ERROR",
            message: "Missing audio file in form field 'file'.",
          };
        }

        if (file.size === 0) {
          set.status = 400;
          return {
            error: "VALIDATION_ERROR",
            message: "Uploaded audio file is empty.",
          };
        }

        const text = await requestTranscription(file);
        return { text };
      } catch (error) {
        if (error instanceof TalkRouteError) {
          set.status = error.status;
          return {
            error: error.code,
            message: error.message,
          };
        }

        set.status = 500;
        return {
          error: "INTERNAL_ERROR",
          message: "Unable to transcribe audio right now.",
        };
      }
    },
    {
      response: {
        200: transcribeResponseSchema,
        400: errorResponseSchema,
        500: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  )
  .post(
    "/options",
    async ({ body, set }) => {
      const trimmedMessage = body.message.trim();
      if (!trimmedMessage) {
        set.status = 400;
        return {
          error: "VALIDATION_ERROR",
          message: "Message cannot be empty.",
        };
      }

      try {
        return await requestChatOptions(trimmedMessage);
      } catch (error) {
        if (error instanceof TalkRouteError) {
          set.status = error.status;
          return {
            error: error.code,
            message: error.message,
          };
        }

        set.status = 500;
        return {
          error: "INTERNAL_ERROR",
          message: "Unable to generate talk options right now.",
        };
      }
    },
    {
      body: optionsRequestSchema,
      response: {
        200: optionsResponseSchema,
        400: errorResponseSchema,
        500: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  );
