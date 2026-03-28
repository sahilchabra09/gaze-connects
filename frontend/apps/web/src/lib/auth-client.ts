import { createAuthClient } from "better-auth/react";
import { normalizeBackendBaseURL } from "@/lib/telegram/api-base";

export const authBaseURL = normalizeBackendBaseURL(process.env.NEXT_PUBLIC_BETTER_AUTH_URL);

export const authClient = createAuthClient({
  ...(authBaseURL ? { baseURL: authBaseURL } : {}),
});

export const { getSession, signIn, signOut, signUp, useSession } = authClient;
