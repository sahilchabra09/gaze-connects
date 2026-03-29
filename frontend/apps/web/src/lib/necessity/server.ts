import "server-only";

import { cookies } from "next/headers";

import { getRequiredBackendBaseURL } from "@/lib/telegram/api-base";

import {
  Necessity,
  NecessityApiErrorPayload,
  NecessityRequestError,
} from "./types";

async function parseNecessityResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? ((await response.json()) as T | NecessityApiErrorPayload) : null;

  if (!response.ok) {
    const errorPayload = payload as NecessityApiErrorPayload | null;
    throw new NecessityRequestError(
      response.status,
      errorPayload?.error ?? "REQUEST_FAILED",
      errorPayload?.message ?? (response.statusText || "Necessity request failed"),
    );
  }

  return payload as T;
}

async function getRequestHeaders(initHeaders?: HeadersInit) {
  const cookieStore = await cookies();
  const headers = new Headers(initHeaders);
  headers.set("Accept", "application/json");

  const cookieHeader = cookieStore.toString();
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }

  return headers;
}

async function necessityServerFetch<T>(pathname: string, init?: RequestInit) {
  try {
    const response = await fetch(new URL(pathname, getRequiredBackendBaseURL()), {
      ...init,
      headers: await getRequestHeaders(init?.headers),
      cache: "no-store",
    });

    return parseNecessityResponse<T>(response);
  } catch (error) {
    if (error instanceof NecessityRequestError) {
      throw error;
    }

    throw new NecessityRequestError(
      503,
      "BACKEND_UNREACHABLE",
      "Could not reach the backend service. Ensure the server is running and NEXT_PUBLIC_BETTER_AUTH_URL points to it.",
    );
  }
}

export async function safeNecessityServerCall<T>(operation: () => Promise<T>) {
  try {
    return {
      data: await operation(),
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof NecessityRequestError
          ? error
          : new NecessityRequestError(
              500,
              "NECESSITY_SERVER_FETCH_FAILED",
              "Failed to load necessity data.",
            ),
    };
  }
}

export function serializeNecessityError(error: NecessityRequestError | null) {
  if (!error) {
    return null;
  }

  return {
    status: error.status,
    code: error.code,
    message: error.message,
  };
}

export const necessityServer = {
  listActive() {
    return necessityServerFetch<Necessity[]>("/api/necessities/active");
  },
};
