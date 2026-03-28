export function normalizeBackendBaseURL(value?: string | null) {
  if (!value) {
    return undefined;
  }

  return value.replace(/\/api\/auth\/?$/, "").replace(/\/$/, "");
}

export function getBackendBaseURL() {
  return (
    normalizeBackendBaseURL(process.env.NEXT_PUBLIC_BETTER_AUTH_URL) ??
    normalizeBackendBaseURL(process.env.NEXT_PUBLIC_API_BASE_URL)
  );
}

export function getRequiredBackendBaseURL() {
  const baseURL = getBackendBaseURL();

  if (!baseURL) {
    throw new Error(
      "Missing NEXT_PUBLIC_BETTER_AUTH_URL or NEXT_PUBLIC_API_BASE_URL for Telegram frontend requests.",
    );
  }

  return baseURL;
}

export function toBackendURL(pathname: string) {
  const baseURL = getBackendBaseURL();
  return baseURL ? new URL(pathname, baseURL).toString() : pathname;
}
