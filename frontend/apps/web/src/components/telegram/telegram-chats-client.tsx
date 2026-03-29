"use client";

import { ArrowLeft, ArrowRight, MessageSquareMore, Radio, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useSession } from "@/lib/auth-client";
import { useTelegramEvents } from "@/hooks/use-telegram-events";
import { telegramClient } from "@/lib/telegram/client";
import type {
  TelegramAuthStatus,
  TelegramChat,
  TelegramContact,
  TelegramContactUpdatedEventData,
  TelegramErrorDescriptor,
  TelegramMessageEventData,
} from "@/lib/telegram/types";
import { isTelegramRequestError } from "@/lib/telegram/types";

import { TelegramCard, TelegramGrid } from "./telegram-grid";
import { TelegramShell } from "./telegram-shell";

type TelegramChatsClientProps = {
  initialAuthStatus: TelegramAuthStatus | null;
  initialContacts: TelegramContact[];
  initialChats: TelegramChat[];
  initialPage: number;
  initialError: { status: number; code: string; message: string } | null;
  paginationBasePath?: string;
  firstPageBackHref?: string;
  firstPageBackSubtitle?: string;
};

const CONTACTS_PER_PAGE = 4;

function sortContacts(contacts: TelegramContact[], chats: Map<string, TelegramChat>) {
  return [...contacts]
    .filter((contact) => contact.isActive)
    .sort((left, right) => {
      if (left.priorityRank !== right.priorityRank) {
        return left.priorityRank - right.priorityRank;
      }

      const leftChat = chats.get(left.id);
      const rightChat = chats.get(right.id);
      const leftTime = leftChat?.lastMessageAt ? Date.parse(leftChat.lastMessageAt) : 0;
      const rightTime = rightChat?.lastMessageAt ? Date.parse(rightChat.lastMessageAt) : 0;
      return rightTime - leftTime;
    });
}

function applyContactEvent(previous: TelegramContact[], event: TelegramContactUpdatedEventData) {
  if (event.action === "deleted" && event.contactId) {
    return previous.filter((contact) => contact.id !== event.contactId);
  }

  if (!event.contact) {
    return previous;
  }

  const next = new Map(previous.map((contact) => [contact.id, contact]));
  next.set(event.contact.id, event.contact);
  return Array.from(next.values());
}

function applyChatEvent(previous: TelegramChat[], event: TelegramMessageEventData) {
  const next = new Map(previous.map((chat) => [chat.contactId, chat]));
  next.set(event.chat.contactId, event.chat);
  return Array.from(next.values());
}

function formatSubtitle(contact: TelegramContact, chat?: TelegramChat) {
  if (!chat) {
    return `${contact.relation} · Ready to open a Telegram chat`;
  }

  const preview = chat.lastMessagePreview || "No recent message preview";
  return `${contact.relation} · ${preview}`;
}

export function TelegramChatsClient({
  initialAuthStatus,
  initialContacts,
  initialChats,
  initialPage,
  initialError,
  paginationBasePath = "/messaging/chats",
  firstPageBackHref = "/messaging",
  firstPageBackSubtitle = "Return to messaging hub.",
}: TelegramChatsClientProps) {
  const { data: session, isPending: sessionPending } = useSession();
  const [authStatus, setAuthStatus] = useState(initialAuthStatus);
  const [contacts, setContacts] = useState(initialContacts);
  const [chats, setChats] = useState(initialChats);
  const [error, setError] = useState<TelegramErrorDescriptor | null>(initialError);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const connectionState = useTelegramEvents({
    ready: (nextStatus) => setAuthStatus(nextStatus),
    auth_state: (nextStatus) => setAuthStatus(nextStatus),
    contact_updated: (event) => setContacts((previous) => applyContactEvent(previous, event)),
    message_new: (event) => setChats((previous) => applyChatEvent(previous, event)),
    message_sent: (event) => setChats((previous) => applyChatEvent(previous, event)),
  });

  useEffect(() => {
    if (sessionPending) {
      return;
    }

    if (!session?.user?.id) {
      setAuthStatus(null);
      setContacts([]);
      setChats([]);
      setError({
        status: 401,
        code: "UNAUTHORIZED",
        message: "Sign in required",
      });
      setIsRefreshing(false);
      return;
    }

    let cancelled = false;

    async function refreshTelegramState() {
      setIsRefreshing(true);

      try {
        const nextAuthStatus = await telegramClient.getAuthStatus();
        if (cancelled) {
          return;
        }

        setAuthStatus(nextAuthStatus);

        const nextContacts = await telegramClient.listContacts();
        if (cancelled) {
          return;
        }

        setContacts(nextContacts);

        if (nextAuthStatus.authState === "authenticated") {
          const nextChats = await telegramClient.listChats();
          if (cancelled) {
            return;
          }

          setChats(nextChats);
        } else {
          setChats([]);
        }

        setError(null);
      } catch (requestError) {
        if (cancelled) {
          return;
        }

        setAuthStatus(null);
        setContacts([]);
        setChats([]);
        setError(
          isTelegramRequestError(requestError)
            ? {
                status: requestError.status,
                code: requestError.code,
                message: requestError.message,
              }
            : {
                status: 500,
                code: "TELEGRAM_CLIENT_REFRESH_FAILED",
                message: "Could not refresh Telegram data.",
              },
        );
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    }

    void refreshTelegramState();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, sessionPending]);

  const appAuthRequired = !sessionPending && !session?.user?.id && error?.status === 401;
  const chatMap = useMemo(() => new Map(chats.map((chat) => [chat.contactId, chat])), [chats]);
  const sortedContacts = useMemo(() => sortContacts(contacts, chatMap), [contacts, chatMap]);
  const totalPages = Math.max(1, Math.ceil(sortedContacts.length / CONTACTS_PER_PAGE));
  const currentPage = Math.min(Math.max(initialPage, 1), totalPages);
  const startIndex = (currentPage - 1) * CONTACTS_PER_PAGE;
  const visibleContacts = sortedContacts.slice(startIndex, startIndex + CONTACTS_PER_PAGE);
  const emptySlots = Math.max(0, CONTACTS_PER_PAGE - visibleContacts.length);
  const noApprovedContacts = !appAuthRequired && sortedContacts.length === 0;

  if (appAuthRequired) {
    return (
      <TelegramShell
        title="Telegram Chats"
        subtitle="This grid depends on the signed-in app session, because every Telegram route is protected on the backend."
        connectionState={connectionState}
      >
        <TelegramGrid>
          <TelegramCard label="Back" subtitle="Return to messaging." icon={<ArrowLeft className="size-5" />} href="/messaging" />
          <TelegramCard label="Sign In" subtitle="Open the app auth screen first." icon={<UserRound className="size-5" />} href="/auth" />
          <TelegramCard label="Connect" subtitle="Once signed in, complete Telegram auth." icon={<MessageSquareMore className="size-5" />} href="/messaging/connect" disabled />
          <TelegramCard label="Contacts" subtitle="Contacts unlock after sign-in." icon={<UserRound className="size-5" />} href="/messaging/contacts" disabled />
          <TelegramCard label="Live State" subtitle={error?.message ?? "Sign in required"} icon={<Radio className="size-5" />} meta={connectionState} />
          <TelegramCard label="Setup" subtitle="Return to setup for patient details if needed." icon={<ArrowRight className="size-5" />} href="/setup" />
        </TelegramGrid>
      </TelegramShell>
    );
  }

  if (noApprovedContacts) {
    return (
      <TelegramShell
        title="Approved Contacts"
        subtitle="Telegram is connected, but this grid only shows active approved contacts. Add or activate contacts first, then their chats will appear here."
        connectionState={connectionState}
      >
        <TelegramGrid>
          <TelegramCard
            label="Back"
            subtitle={firstPageBackSubtitle}
            icon={<ArrowLeft className="size-5" />}
            href={firstPageBackHref}
            meta="Hub"
          />
          <TelegramCard
            label="Contacts"
            subtitle="Create or activate the approved contact list for this patient."
            icon={<UserRound className="size-5" />}
            href="/messaging/contacts"
          />
          <TelegramCard
            label="Setup"
            subtitle="Review the Telegram setup flow and patient details."
            icon={<ArrowRight className="size-5" />}
            href="/setup?tab=telegram"
          />
          <TelegramCard
            label={authStatus?.authState === "authenticated" ? "Reconnect" : "Connect"}
            subtitle={
              authStatus?.authState === "authenticated"
                ? "Telegram is connected. Reopen setup only if you need to reconnect it."
                : "Finish Telegram authentication before opening chats."
            }
            icon={<MessageSquareMore className="size-5" />}
            href="/messaging/connect"
          />
          <TelegramCard
            label="Telegram Status"
            subtitle={
              isRefreshing
                ? "Refreshing Telegram state..."
                : authStatus?.authState === "authenticated"
                  ? "Telegram is connected. No approved contacts are ready yet."
                  : error?.message ?? "Telegram status will update here."
            }
            icon={<Radio className="size-5" />}
            meta={authStatus?.authState?.replaceAll("_", " ") ?? connectionState}
          />
          <TelegramCard
            label="Next"
            subtitle="More chats appear automatically after contacts are added."
            icon={<ArrowRight className="size-5" />}
            disabled
            meta="Page 1 of 1"
          />
        </TelegramGrid>
      </TelegramShell>
    );
  }

  return (
    <TelegramShell
      title="Approved Contacts"
      subtitle="Each page shows four approved contacts between a previous-step card and a next-page card. Pick a person to open or resume their Telegram chat."
      connectionState={connectionState}
    >
      <TelegramGrid>
        <TelegramCard
          label="Back"
          subtitle={currentPage > 1 ? "Go to the previous contacts page." : firstPageBackSubtitle}
          icon={<ArrowLeft className="size-5" />}
          href={currentPage > 1 ? `${paginationBasePath}?page=${currentPage - 1}` : firstPageBackHref}
          meta={currentPage > 1 ? `Page ${currentPage - 1}` : "Hub"}
        />

        {visibleContacts.map((contact) => {
          const chat = chatMap.get(contact.id);

          return (
            <TelegramCard
              key={contact.id}
              label={contact.name}
              subtitle={formatSubtitle(contact, chat)}
              meta={`Priority ${contact.priorityRank}`}
              badge={chat?.unreadCount ? chat.unreadCount : undefined}
              icon={<UserRound className="size-5" />}
              href={`/messaging/chats/${contact.id}`}
            />
          );
        })}

        {Array.from({ length: emptySlots }).map((_, index) => (
          <TelegramCard
            key={`empty-${index}`}
            label="Empty"
            subtitle="No additional approved contact on this slot."
            icon={<MessageSquareMore className="size-5" />}
            disabled
            tone="muted"
          />
        ))}

        <TelegramCard
          label="Next"
          subtitle={currentPage < totalPages ? "Move to the next four contacts." : "No more contacts on the next page."}
          icon={<ArrowRight className="size-5" />}
          href={currentPage < totalPages ? `${paginationBasePath}?page=${currentPage + 1}` : undefined}
          disabled={currentPage >= totalPages}
          meta={`Page ${currentPage} of ${totalPages}`}
        />
      </TelegramGrid>
    </TelegramShell>
  );
}
