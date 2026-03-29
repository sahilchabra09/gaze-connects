"use client";

import Link from "next/link";
import { ArrowLeft, KeyRound, Phone, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { useTelegramEvents } from "@/hooks/use-telegram-events";
import { telegramClient } from "@/lib/telegram/client";
import type { TelegramAuthStatus } from "@/lib/telegram/types";
import { isTelegramRequestError } from "@/lib/telegram/types";

import { TelegramShell } from "./telegram-shell";

type TelegramConnectClientProps = {
  initialAuthStatus: TelegramAuthStatus | null;
  initialError: { status: number; code: string; message: string } | null;
};

export function TelegramConnectClient({
  initialAuthStatus,
  initialError,
}: TelegramConnectClientProps) {
  const [authStatus, setAuthStatus] = useState(initialAuthStatus);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"phone" | "code" | null>(null);
  const [error, setError] = useState(initialError?.status === 401 ? "" : (initialError?.message ?? ""));
  const [message, setMessage] = useState("");

  const connectionState = useTelegramEvents({
    ready: (nextStatus) => {
      setAuthStatus(nextStatus);
      if (initialError?.status === 401) {
        setError("");
      }
    },
    auth_state: (nextStatus) => {
      setAuthStatus(nextStatus);
      if (initialError?.status === 401) {
        setError("");
      }
    },
  });

  const appAuthRequired = !authStatus && initialError?.status === 401;
  const canSubmitPhone = !busy && phoneNumber.trim().length >= 8;
  const canSubmitCode = !busy && code.trim().length >= 1 && authStatus?.authState === "waiting_code";

  async function handleStartAuth() {
    if (!canSubmitPhone) {
      return;
    }

    setBusy("phone");
    setError("");
    setMessage("");

    try {
      const nextStatus = await telegramClient.startAuth(phoneNumber.trim());
      setAuthStatus(nextStatus);
      setMessage(
        nextStatus.authState === "waiting_code"
          ? "Phone number accepted. Enter the Telegram verification code."
          : nextStatus.authState === "authenticated"
            ? "Telegram is already connected. No verification code was requested."
            : `Telegram auth state: ${nextStatus.authState}.`,
      );
    } catch (requestError) {
      setError(
        isTelegramRequestError(requestError) ? requestError.message : "Telegram auth could not be started.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleVerifyCode() {
    if (!canSubmitCode) {
      return;
    }

    setBusy("code");
    setError("");
    setMessage("");

    try {
      const nextStatus = await telegramClient.verifyCode(code.trim());
      setAuthStatus(nextStatus);
      setMessage(
        nextStatus.authState === "authenticated"
          ? "Telegram is now connected."
          : "Telegram verification updated.",
      );
    } catch (requestError) {
      setError(isTelegramRequestError(requestError) ? requestError.message : "Telegram code verification failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <TelegramShell
      title="Telegram Connect"
      subtitle="This screen mirrors the backend auth states: waiting for phone number, waiting for code, unsupported 2-step password, authenticated, or expired."
      connectionState={connectionState}
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col gap-3">
        <div className="flex items-center justify-start">
          <Link
            href="/messaging"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
          >
            <ArrowLeft className="size-4" />
            Back
          </Link>
        </div>

        {message ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
        ) : null}

        <div className="grid min-h-0 flex-1 gap-3">
          <div className="rounded-[28px] border border-zinc-700/70 bg-zinc-950/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/4">
                <Phone className="size-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">Phone Number</h2>
                <p className="text-sm text-zinc-400">Used for `POST /auth/start`.</p>
              </div>
            </div>

            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-zinc-300">Telegram phone number</span>
              <input
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                placeholder="+91XXXXXXXXXX"
                className="h-14 w-full rounded-2xl border border-white/10 bg-white/4 px-4 text-sm text-white outline-none transition placeholder:text-zinc-500 focus:border-cyan-400/60 focus:bg-white/[0.07]"
                disabled={appAuthRequired || busy === "code"}
              />
            </label>

            <button
              type="button"
              onClick={handleStartAuth}
              disabled={!canSubmitPhone || appAuthRequired}
              className="mt-3 inline-flex h-12 items-center justify-center rounded-2xl bg-white px-5 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "phone" ? "Submitting..." : "Start Telegram Auth"}
            </button>
          </div>

          <div className="rounded-[28px] border border-zinc-700/70 bg-zinc-950/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/4">
                <KeyRound className="size-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">Verification Code</h2>
                <p className="text-sm text-zinc-400">Used for `POST /auth/verify-code`.</p>
              </div>
            </div>

            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-zinc-300">Telegram code</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="12345"
                className="h-14 w-full rounded-2xl border border-white/10 bg-white/4 px-4 text-sm text-white outline-none transition placeholder:text-zinc-500 focus:border-cyan-400/60 focus:bg-white/[0.07]"
                disabled={appAuthRequired || busy === "phone" || authStatus?.authState === "waiting_password"}
              />
            </label>

            <button
              type="button"
              onClick={handleVerifyCode}
              disabled={!canSubmitCode || appAuthRequired || authStatus?.authState === "waiting_password"}
              className="mt-3 inline-flex h-12 items-center justify-center rounded-2xl bg-white px-5 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "code" ? "Checking..." : "Verify Code"}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Link
              href="/messaging"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
            >
              <ArrowLeft className="size-4" />
              Back
            </Link>
            <Link
              href={appAuthRequired ? "/auth" : "/messaging/chats"}
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors ${
                !appAuthRequired && authStatus?.authState !== "authenticated"
                  ? "pointer-events-none border-zinc-800 bg-zinc-900/60 text-zinc-500"
                  : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-zinc-500 hover:bg-zinc-800"
              }`}
            >
              {appAuthRequired ? <ShieldAlert className="size-4" /> : <ShieldCheck className="size-4" />}
              {appAuthRequired ? "Sign In" : "Chats"}
            </Link>
            <Link
              href={appAuthRequired ? "/setup" : "/messaging/contacts"}
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors ${
                appAuthRequired
                  ? "pointer-events-none border-zinc-800 bg-zinc-900/60 text-zinc-500"
                  : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-zinc-500 hover:bg-zinc-800"
              }`}
            >
              <ShieldCheck className="size-4" />
              Contacts
            </Link>
          </div>

          {authStatus?.authState === "waiting_password" ? (
            <div className="rounded-[28px] border border-amber-500/25 bg-amber-500/10 p-5 text-sm text-amber-100">
              Telegram accounts that require a second password step are not supported by the current backend. Use a Telegram account without 2-step verification for now.
            </div>
          ) : null}
        </div>
      </div>
    </TelegramShell>
  );
}
