"use client";

import { toBackendURL } from "@/lib/telegram/api-base";

import {
  ApplianceApiErrorPayload,
  ApplianceControlPayload,
  ApplianceControlSuccess,
  ApplianceRequestError,
} from "./types";

async function parseApplianceResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? ((await response.json()) as T | ApplianceApiErrorPayload) : null;

  if (!response.ok) {
    const errorPayload = payload as ApplianceApiErrorPayload | null;
    throw new ApplianceRequestError(
      response.status,
      errorPayload?.error ?? "REQUEST_FAILED",
      errorPayload?.message ?? (response.statusText || "Appliance request failed"),
    );
  }

  return payload as T;
}

async function applianceClientFetch<T>(pathname: string, init?: RequestInit): Promise<T> {
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

  return parseApplianceResponse<T>(response);
}

export const applianceClient = {
  control(input: ApplianceControlPayload) {
    return applianceClientFetch<ApplianceControlSuccess>("/api/appliances/control", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};
