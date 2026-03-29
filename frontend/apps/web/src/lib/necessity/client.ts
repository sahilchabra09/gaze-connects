"use client";

import { toBackendURL } from "@/lib/telegram/api-base";

import {
  Necessity,
  NecessityApiErrorPayload,
  NecessityInput,
  NecessityRequestError,
  NecessityTriggerResponse,
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

async function necessityClientFetch<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(toBackendURL(pathname), {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  return parseNecessityResponse<T>(response);
}

export const necessityClient = {
  list() {
    return necessityClientFetch<Necessity[]>("/api/necessities");
  },
  listActive() {
    return necessityClientFetch<Necessity[]>("/api/necessities/active");
  },
  create(input: NecessityInput) {
    return necessityClientFetch<Necessity>("/api/necessities", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  update(necessityId: string, input: Partial<NecessityInput>) {
    return necessityClientFetch<Necessity>(`/api/necessities/${necessityId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  trigger(necessityId: string) {
    return necessityClientFetch<NecessityTriggerResponse>(`/api/necessities/${necessityId}/trigger`, {
      method: "POST",
    });
  },
};
