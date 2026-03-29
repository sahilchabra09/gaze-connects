"use client";

import Link from "next/link";
import { LoaderCircle, MessageSquare, Radio, RefreshCcw, ShieldCheck, SquarePen, UserRoundPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useTelegramEvents } from "@/hooks/use-telegram-events";
import { telegramClient } from "@/lib/telegram/client";
import type { TelegramAuthStatus } from "@/lib/telegram/types";
import { isTelegramRequestError } from "@/lib/telegram/types";

function describeAuthStatus(authStatus: TelegramAuthStatus | null) {
  if (!authStatus) {
    return "Telegram is not connected yet.";
  }

  switch (authStatus.authState) {
    case "authenticated":
      return authStatus.connectedAt
        ? `Connected on ${new Date(authStatus.connectedAt).toLocaleString()}`
        : "Telegram is connected and ready.";
    case "waiting_code":
      return "Phone accepted. Finish verification with the Telegram code.";
    case "waiting_password":
      return "This account requires 2-step verification, which is currently unsupported.";
    case "expired":
      return "Telegram session expired. Reconnect to continue.";
    default:
      return "Telegram is not connected yet.";
  }
}

export function TelegramSetupTab() {
  const [authStatus, setAuthStatus] = useState<TelegramAuthStatus | null>(null);
  const [activeContacts, setActiveContacts] = useState(0);
  const [mappedChats, setMappedChats] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const connectionState = useTelegramEvents({
    ready: (nextStatus) => setAuthStatus(nextStatus),
    auth_state: (nextStatus) => setAuthStatus(nextStatus),
  });

  async function loadTelegramSetupState(showRefreshSpinner = false) {
    if (showRefreshSpinner) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    try {
      const nextAuthStatus = await telegramClient.getAuthStatus();
      setAuthStatus(nextAuthStatus);

      const contacts = await telegramClient.listContacts();
      setActiveContacts(contacts.filter((contact) => contact.isActive).length);

      if (nextAuthStatus.authState === "authenticated") {
        const chats = await telegramClient.listChats();
        setMappedChats(chats.length);
        setUnreadChats(chats.reduce((total, chat) => total + chat.unreadCount, 0));
      } else {
        setMappedChats(0);
        setUnreadChats(0);
      }
    } catch (requestError) {
      setError(
        isTelegramRequestError(requestError)
          ? requestError.message
          : "Could not load Telegram setup state.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadTelegramSetupState();
  }, []);

  const connectLabel = authStatus?.authState === "authenticated" ? "Reconnect" : "Connect";

  const statusMeta = useMemo(() => {
    if (loading) {
      return "loading";
    }

    return authStatus?.authState.replaceAll("_", " ") ?? "not connected";
  }, [authStatus, loading]);

  return (
    <section className="space-y-5 rounded-2xl border border-zinc-800/80 bg-zinc-950/55 p-5 transition-colors hover:border-zinc-700/85 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-100">Telegram Setup</h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Manage Telegram connection, contacts, and live stream status from one setup tab.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadTelegramSetupState(true)}
          disabled={loading || refreshing}
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
          Check Connection
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/65 p-4">
          <div className="flex items-center gap-2 text-zinc-100">
            <ShieldCheck className="size-4" />
            <p className="text-sm font-semibold">Telegram Status</p>
          </div>
          <p className="mt-2 text-sm text-zinc-300">{loading ? "Loading status..." : describeAuthStatus(authStatus)}</p>
          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-zinc-500">{statusMeta}</p>
        </div>

        <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/65 p-4">
          <div className="flex items-center gap-2 text-zinc-100">
            <Radio className="size-4" />
            <p className="text-sm font-semibold">Live Updates</p>
          </div>
          <p className="mt-2 text-sm text-zinc-300">SSE stream keeps auth and chat state refreshed.</p>
          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-zinc-500">{connectionState}</p>
        </div>

        <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/65 p-4">
          <div className="flex items-center gap-2 text-zinc-100">
            <MessageSquare className="size-4" />
            <p className="text-sm font-semibold">Chats</p>
          </div>
          <p className="mt-2 text-sm text-zinc-300">{mappedChats} mapped chats{unreadChats ? ` · ${unreadChats} unread` : ""}</p>
          <Link
            href="/messaging"
            className="mt-3 inline-flex h-9 items-center rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
          >
            Open Messaging
          </Link>
        </div>

        <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/65 p-4">
          <div className="flex items-center gap-2 text-zinc-100">
            <SquarePen className="size-4" />
            <p className="text-sm font-semibold">{connectLabel}</p>
          </div>
          <p className="mt-2 text-sm text-zinc-300">Start or revisit Telegram auth flow.</p>
          <Link
            href="/messaging/connect"
            className="mt-3 inline-flex h-9 items-center rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
          >
            {connectLabel}
          </Link>
        </div>

        <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/65 p-4">
          <div className="flex items-center gap-2 text-zinc-100">
            <UserRoundPlus className="size-4" />
            <p className="text-sm font-semibold">Contacts</p>
          </div>
          <p className="mt-2 text-sm text-zinc-300">{activeContacts} active approved contacts (add friends here).</p>
          <Link
            href="/messaging/contacts"
            className="mt-3 inline-flex h-9 items-center rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
          >
            Manage Contacts
          </Link>
        </div>
      </div>
    </section>
  );
}
