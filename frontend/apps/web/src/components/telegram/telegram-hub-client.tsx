"use client";

import {
  ArrowLeft,
  MessageSquare,
  Radio,
  ShieldCheck,
  SquarePen,
  UserRoundCog,
} from "lucide-react";
import { useState } from "react";

import { useTelegramEvents } from "@/hooks/use-telegram-events";
import type { TelegramAuthStatus } from "@/lib/telegram/types";

import { TelegramCard, TelegramGrid } from "./telegram-grid";
import { TelegramShell } from "./telegram-shell";

type TelegramHubClientProps = {
  initialAuthStatus: TelegramAuthStatus | null;
  initialError: { status: number; code: string; message: string } | null;
  counts: {
    activeContacts: number;
    mappedChats: number;
    unreadChats: number;
  };
};

function describeAuthStatus(authStatus: TelegramAuthStatus | null, fallbackMessage: string) {
  if (!authStatus) {
    return fallbackMessage;
  }

  switch (authStatus.authState) {
    case "authenticated":
      return authStatus.connectedAt
        ? `Connected on ${new Date(authStatus.connectedAt).toLocaleString()}`
        : "Telegram is connected and ready.";
    case "waiting_code":
      return "Phone accepted. Finish Telegram verification with the code screen.";
    case "waiting_password":
      return "This Telegram account requires 2-step verification, which this version does not support.";
    case "expired":
      return "The Telegram session expired. Reconnect to continue messaging.";
    default:
      return "Telegram is not connected yet. Start with the connect flow.";
  }
}

export function TelegramHubClient({
  initialAuthStatus,
  initialError,
  counts,
}: TelegramHubClientProps) {
  const [authStatus, setAuthStatus] = useState(initialAuthStatus);

  const connectionState = useTelegramEvents({
    ready: (nextStatus) => setAuthStatus(nextStatus),
    auth_state: (nextStatus) => setAuthStatus(nextStatus),
  });

  const appAuthRequired = !authStatus && initialError?.status === 401;
  const authMessage = appAuthRequired
    ? "Sign in first to reach the Telegram backend routes."
    : initialError?.message ?? "Live Telegram state will appear here as soon as the stream connects.";

  return (
    <TelegramShell
      title="Messaging"
      subtitle="Telegram now lives inside the existing gaze-first messaging area. Connect the account, browse approved contacts, and open a chat in the same six-card flow."
      connectionState={connectionState}
    >
      <TelegramGrid>
        <TelegramCard
          label="Back"
          subtitle="Return to the home mode grid."
          icon={<ArrowLeft className="size-5" />}
          href="/"
        />
        <TelegramCard
          label={appAuthRequired ? "Sign In" : "Chats"}
          subtitle={
            appAuthRequired
              ? "Authentication is required before chats can be opened."
              : `${counts.activeContacts} active contacts, ${counts.mappedChats} mapped chats.`
          }
          icon={<MessageSquare className="size-5" />}
          href={appAuthRequired ? "/auth" : "/messaging/chats"}
          badge={!appAuthRequired && counts.unreadChats > 0 ? counts.unreadChats : undefined}
        />
        <TelegramCard
          label={appAuthRequired ? "Setup" : "Contacts"}
          subtitle={
            appAuthRequired
              ? "Finish sign-in or setup, then return here."
              : "Create, edit, and prioritize the approved Telegram contact list."
          }
          icon={<UserRoundCog className="size-5" />}
          href={appAuthRequired ? "/setup" : "/messaging/contacts"}
        />
        <TelegramCard
          label="Telegram Status"
          subtitle={describeAuthStatus(authStatus, authMessage)}
          icon={<ShieldCheck className="size-5" />}
          meta={authStatus ? authStatus.authState.replaceAll("_", " ") : initialError?.code ?? "not connected"}
          tone={appAuthRequired ? "muted" : "default"}
        />
        <TelegramCard
          label={appAuthRequired ? "Authenticate" : authStatus?.authState === "authenticated" ? "Reconnect" : "Connect"}
          subtitle={
            appAuthRequired
              ? "Open the main auth screen first."
              : authStatus?.authState === "waiting_code"
                ? "Finish code verification."
                : "Start or revisit the Telegram connect flow."
          }
          icon={<SquarePen className="size-5" />}
          href={appAuthRequired ? "/auth" : "/messaging/connect"}
        />
        <TelegramCard
          label="Live Updates"
          subtitle="SSE keeps auth state, unread counts, and chat activity fresh after the first render."
          icon={<Radio className="size-5" />}
          meta={connectionState}
        />
      </TelegramGrid>
    </TelegramShell>
  );
}
