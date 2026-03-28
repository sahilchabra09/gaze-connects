"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { authBaseURL } from "@/lib/auth-client";

type VerifyState = "loading" | "success" | "error";

type VerifyEmailContentProps = {
  token?: string | null;
};

export function VerifyEmailContent({ token = null }: VerifyEmailContentProps) {
  const [state, setState] = useState<VerifyState>("loading");
  const [message, setMessage] = useState("Verifying your email...");

  useEffect(() => {
    async function verifyEmail() {
      if (!token) {
        setState("error");
        setMessage("Verification token is missing.");
        return;
      }

      try {
        const response = await fetch(
          `${authBaseURL || "http://localhost:8000"}/api/auth/verify-email?token=${encodeURIComponent(token)}`,
          {
            credentials: "include",
          }
        );

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: string } | null;

          setState("error");
          setMessage(payload?.message || "Verification failed. The token may have expired.");
          return;
        }

        setState("success");
        setMessage("Email verified successfully. You can sign in now.");
      } catch {
        setState("error");
        setMessage("Verification failed because the auth server could not be reached.");
      }
    }

    void verifyEmail();
  }, [token]);

  return (
    <main className="grid min-h-screen place-items-center bg-black px-4 py-10 text-zinc-100">
      <section className="w-full max-w-lg rounded-3xl border border-zinc-800 bg-zinc-950/70 p-8">
        <p className="text-sm uppercase tracking-[0.24em] text-zinc-500">Verify email</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Account confirmation</h1>
        <p
          className={`mt-6 text-sm leading-6 ${
            state === "error" ? "text-red-400" : state === "success" ? "text-emerald-400" : "text-zinc-400"
          }`}
        >
          {message}
        </p>

        <div className="mt-8 flex gap-3">
          <Button asChild>
            <Link href="/auth">Go to auth</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Back home</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
