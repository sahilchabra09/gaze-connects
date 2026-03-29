import { toBackendURL } from "@/lib/telegram/api-base";

export type TalkTranscriptionResponse = {
  text: string;
};

export type TalkOptionsResponse = {
  options: string[];
  recentHistory: string[][];
};

type TalkErrorResponse = {
  error?: string;
  message?: string;
};

function extractErrorMessage(payload: TalkErrorResponse | null, fallback: string) {
  return payload?.message?.trim() || fallback;
}

export async function transcribeTalkAudio(audioFile: File) {
  const formData = new FormData();
  formData.append("file", audioFile);

  const response = await fetch(toBackendURL("/api/talk/transcribe"), {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  const payload = (await response.json().catch(() => null)) as TalkTranscriptionResponse | TalkErrorResponse | null;
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload as TalkErrorResponse | null, "Unable to transcribe audio right now."));
  }

  const text = (payload as TalkTranscriptionResponse | null)?.text?.trim();
  if (!text) {
    throw new Error("No speech detected. Please try again.");
  }

  return text;
}

export async function fetchTalkOptions(message: string) {
  const response = await fetch(toBackendURL("/api/talk/options"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ message }),
  });

  const payload = (await response.json().catch(() => null)) as TalkOptionsResponse | TalkErrorResponse | null;
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload as TalkErrorResponse | null, "Unable to generate AI reply options."));
  }

  const options = (payload as TalkOptionsResponse | null)?.options ?? [];
  if (options.length === 0) {
    throw new Error("No AI suggestions available right now.");
  }

  return {
    options: options.slice(0, 4),
    recentHistory: (payload as TalkOptionsResponse | null)?.recentHistory ?? [],
  } satisfies TalkOptionsResponse;
}
