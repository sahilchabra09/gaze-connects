import { createAuthClient } from "better-auth/react";

function normalizeAuthBaseURL(value?: string) {
  if (!value) {
    return undefined;
  }

  return value.replace(/\/api\/auth\/?$/, "").replace(/\/$/, "");
}

export const authBaseURL = normalizeAuthBaseURL(process.env.NEXT_PUBLIC_BETTER_AUTH_URL);

export const authClient = createAuthClient({
  ...(authBaseURL ? { baseURL: authBaseURL } : {}),
});

export const { getSession, signIn, signOut, signUp, useSession } = authClient;
