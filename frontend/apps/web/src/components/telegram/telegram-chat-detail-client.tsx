"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bot,
  LoaderCircle,
  MessageSquare,
  RefreshCcw,
  Send,
} from "lucide-react";
import { useRef, useState } from "react";

import { useTelegramEvents } from "@/hooks/use-telegram-events";
import { telegramClient } from "@/lib/telegram/client";
import type {
  TelegramAuthStatus,
  TelegramChat,
  TelegramContact,
  TelegramMessage,
  TelegramOpenChatResponse,
  TelegramReplyOption,
} from "@/lib/telegram/types";
import { isTelegramRequestError } from "@/lib/telegram/types";

import { TelegramCard, TelegramGrid } from "./telegram-grid";
import { TelegramShell } from "./telegram-shell";

type TelegramChatDetailClientProps = {
  initialAuthStatus: TelegramAuthStatus | null;
  initialOpenChat: TelegramOpenChatResponse | null;
  initialReplyOptions: TelegramReplyOption[];
  initialError: { status: number; code: string; message: string } | null;
};

const HISTORY_MESSAGES_PER_PAGE = 3;

function sortMessagesDescending(messages: TelegramMessage[]) {
  return [...messages].sort((left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt));
}

function sortMessagesAscending(messages: TelegramMessage[]) {
  return [...messages].sort((left, right) => Date.parse(left.sentAt) - Date.parse(right.sentAt));
}

function mergeMessages(previous: TelegramMessage[], incoming: TelegramMessage[]) {
  const next = new Map(previous.map((message) => [message.id, message]));

  for (const message of incoming) {
    next.set(message.id, message);
  }

  return sortMessagesDescending(Array.from(next.values()));
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ChatPreviewCard({
  messages,
  onOpen,
}: {
  messages: TelegramMessage[];
  onOpen: () => void;
}) {
  const previewMessages = sortMessagesAscending(messages).slice(-3);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative flex h-full min-h-42.5 w-full flex-col items-center justify-center gap-5 rounded-3xl border border-zinc-700/50 bg-zinc-950 p-5 text-center shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-all duration-300 hover:-translate-y-0.5 hover:border-zinc-400/85 hover:bg-zinc-900"
    >
      <div className="w-full max-w-90 rounded-2xl border border-white/10 bg-black/60 p-3 text-left shadow-[0_14px_40px_rgba(0,0,0,0.45)]">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          <MessageSquare className="size-3.5" />
          Chat Preview
        </div>

        <div className="space-y-2">
          {previewMessages.length ? (
            previewMessages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[88%] rounded-xl px-3 py-2 text-xs leading-4 ${
                  message.direction === "outgoing"
                    ? "ml-auto border border-cyan-400/20 bg-cyan-400/10 text-cyan-50"
                    : "border border-white/10 bg-white/5 text-zinc-200"
                }`}
              >
                <p className="line-clamp-2">{message.text || `[${message.contentType}]`}</p>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-400">
              No messages yet.
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function HistoryModal({
  open,
  messages,
  currentPage,
  onBack,
  onNext,
  onClose,
}: {
  open: boolean;
  messages: TelegramMessage[];
  currentPage: number;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const orderedMessages = sortMessagesAscending(messages);
  const totalPages = Math.max(1, Math.ceil(orderedMessages.length / HISTORY_MESSAGES_PER_PAGE));
  const clampedPage = Math.min(currentPage, totalPages - 1);
  const pageStart = clampedPage * HISTORY_MESSAGES_PER_PAGE;
  const visibleMessages = orderedMessages.slice(pageStart, pageStart + HISTORY_MESSAGES_PER_PAGE);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="flex h-[min(86vh,880px)] w-full max-w-4xl flex-col rounded-[32px] border border-white/10 bg-[#080808] shadow-[0_30px_120px_rgba(0,0,0,0.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Chat History</p>
            <p className="mt-2 text-lg font-semibold text-white">Tap outside to minimize</p>
          </div>
        </div>

        <div className="flex h-full flex-1 flex-col overflow-hidden px-6 py-5">
          <div className="min-h-0 flex-1 space-y-3 overflow-hidden">
            {visibleMessages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[82%] rounded-[24px] border px-4 py-3 ${
                  message.direction === "outgoing"
                    ? "ml-auto border-cyan-400/20 bg-cyan-400/10 text-cyan-50"
                    : "border-white/10 bg-white/4 text-zinc-100"
                }`}
              >
                <p className="line-clamp-2 whitespace-pre-wrap text-sm leading-6">{message.text || `[${message.contentType}]`}</p>
                <p className="mt-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{formatTimestamp(message.sentAt)}</p>
              </div>
            ))}

            {!visibleMessages.length ? (
              <div className="rounded-[24px] border border-dashed border-white/12 bg-white/2 p-4 text-sm text-zinc-500">
                No messages on this page.
              </div>
            ) : null}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={onBack}
              disabled={clampedPage === 0}
              className="relative flex min-h-30 items-center justify-center gap-3 rounded-3xl border border-zinc-700/50 bg-zinc-950 px-5 text-center text-4xl font-medium tracking-tight text-zinc-100/95 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-all duration-300 hover:-translate-y-0.5 hover:border-zinc-400/85 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <ArrowLeft className="size-8" />
              Back
            </button>

            <button
              type="button"
              onClick={onNext}
              disabled={clampedPage >= totalPages - 1}
              className="relative flex min-h-30 items-center justify-center gap-3 rounded-3xl border border-zinc-700/50 bg-zinc-950 px-5 text-center text-4xl font-medium tracking-tight text-zinc-100/95 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-all duration-300 hover:-translate-y-0.5 hover:border-zinc-400/85 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-55"
            >
              Next
              <ArrowRight className="size-8" />
            </button>
          </div>

          <p className="mt-3 text-center text-xs uppercase tracking-[0.2em] text-zinc-500">
            Page {clampedPage + 1} of {totalPages}
          </p>
        </div>
      </div>
    </div>
  );
}

export function TelegramChatDetailClient({
  initialAuthStatus,
  initialOpenChat,
  initialReplyOptions,
  initialError,
}: TelegramChatDetailClientProps) {
  const [authStatus, setAuthStatus] = useState(initialAuthStatus);
  const [contact, setContact] = useState<TelegramContact | null>(initialOpenChat?.contact ?? null);
  const [chat, setChat] = useState<TelegramChat | null>(initialOpenChat?.chat ?? null);
  const [messages, setMessages] = useState<TelegramMessage[]>(
    initialOpenChat ? sortMessagesDescending(initialOpenChat.messages) : [],
  );
  const [aiReplyOptions, setAiReplyOptions] = useState<TelegramReplyOption[]>(initialReplyOptions.slice(0, 3));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [busyReplyId, setBusyReplyId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(initialError?.message ?? "");
  const latestReplyRequestId = useRef(0);

  async function refreshReplyOptions(options?: {
    chatId?: string;
    showRetrySpinner?: boolean;
    successNotice?: string;
  }) {
    const targetChatId = options?.chatId ?? chat?.chatId;

    if (!targetChatId) {
      return;
    }

    const requestId = latestReplyRequestId.current + 1;
    latestReplyRequestId.current = requestId;

    if (options?.showRetrySpinner) {
      setRetrying(true);
    }

    try {
      const nextReplyOptions = await telegramClient.getReplyOptions(targetChatId);

      if (requestId !== latestReplyRequestId.current) {
        return;
      }

      setAiReplyOptions(nextReplyOptions.slice(0, 3));
      setError("");

      if (options?.successNotice) {
        setNotice(options.successNotice);
      }
    } catch (requestError) {
      if (requestId !== latestReplyRequestId.current) {
        return;
      }

      setError(isTelegramRequestError(requestError) ? requestError.message : "AI replies could not be refreshed.");
    } finally {
      if (options?.showRetrySpinner) {
        setRetrying(false);
      }
    }
  }

  const connectionState = useTelegramEvents({
    ready: (nextStatus) => setAuthStatus(nextStatus),
    auth_state: (nextStatus) => setAuthStatus(nextStatus),
    chat_opened: (event) => {
      if (event.contact.id !== contact?.id) {
        return;
      }

      setContact(event.contact);
      setChat(event.chat);
    },
    contact_updated: (event) => {
      if (event.contact && event.contact.id === contact?.id) {
        setContact(event.contact);
      }

      if (event.action === "deleted" && event.contactId === contact?.id) {
        setError("This contact was removed from the approved Telegram list.");
      }
    },
    message_new: (event) => {
      if (event.chatId !== chat?.chatId) {
        return;
      }

      setChat(event.chat);
      setMessages((previous) => mergeMessages(previous, [event.message]));
      void refreshReplyOptions({ chatId: event.chatId });
    },
    message_sent: (event) => {
      if (event.chatId !== chat?.chatId) {
        return;
      }

      setChat(event.chat);
      setMessages((previous) => mergeMessages(previous, [event.message]));
    },
  });

  const appAuthRequired = !authStatus && initialError?.status === 401;
  const telegramAuthRequired = initialError?.code === "TELEGRAM_NOT_AUTHENTICATED";
  const historyTotalPages = Math.max(1, Math.ceil(messages.length / HISTORY_MESSAGES_PER_PAGE));
  const replySlots = Array.from({ length: 3 }, (_, index) => aiReplyOptions[index] ?? null);

  function openHistoryModal() {
    setHistoryPage(historyTotalPages - 1);
    setHistoryOpen(true);
  }

  async function handleRetry() {
    setNotice("");
    await refreshReplyOptions({
      showRetrySpinner: true,
      successNotice: "AI suggestions refreshed from the latest 20 Telegram messages.",
    });
  }

  async function handleSendReply(option: TelegramReplyOption) {
    if (!chat) {
      return;
    }

    const optimisticMessage: TelegramMessage = {
      id: `optimistic-${Date.now()}`,
      chatId: chat.chatId,
      direction: "outgoing",
      text: option.text,
      contentType: "text",
      sentAt: new Date().toISOString(),
      senderLabel: "You",
    };

    setBusyReplyId(option.id);
    setError("");
    setNotice("");
    setMessages((previous) => mergeMessages(previous, [optimisticMessage]));

    try {
      const sentMessage = await telegramClient.sendMessage(chat.chatId, option.text, option.source);
      setMessages((previous) => mergeMessages(previous.filter((message) => message.id !== optimisticMessage.id), [sentMessage]));
      setNotice(`Sent: ${option.text}`);
    } catch (requestError) {
      setMessages((previous) => previous.filter((message) => message.id !== optimisticMessage.id));
      setError(isTelegramRequestError(requestError) ? requestError.message : "Reply could not be sent.");
    } finally {
      setBusyReplyId(null);
    }
  }

  if (appAuthRequired || !chat || !contact) {
    const actionLabel = appAuthRequired ? "Sign In" : "Connect";
    const actionSubtitle = appAuthRequired
      ? "Open the main app auth flow."
      : "Finish Telegram connect/auth first.";
    const actionHref = appAuthRequired ? "/auth" : "/messaging/connect";

    return (
      <TelegramShell
        title="Telegram Chat"
        subtitle="Open chat depends on both app auth and a valid approved contact."
        connectionState={connectionState}
      >
        <TelegramGrid>
          <TelegramCard label="Back" subtitle="Return to contacts." icon={<ArrowLeft className="size-5" />} href="/messaging/chats" />
          <TelegramCard label={actionLabel} subtitle={actionSubtitle} icon={<Bot className="size-5" />} href={actionHref} />
          <TelegramCard
            label="Connect"
            subtitle={telegramAuthRequired ? "Telegram authentication is required for this chat." : "Reconnect Telegram if needed."}
            icon={<RefreshCcw className="size-5" />}
            href="/messaging/connect"
          />
          <TelegramCard label="Contacts" subtitle="Return to the approved contact grid." icon={<MessageSquare className="size-5" />} href="/messaging/chats" />
          <TelegramCard label="Error" subtitle={initialError?.message ?? "Chat data is unavailable."} icon={<Bot className="size-5" />} tone="danger" />
          <TelegramCard label="Messaging Hub" subtitle="Go back to the Telegram hub." icon={<ArrowLeft className="size-5" />} href="/messaging" />
        </TelegramGrid>
      </TelegramShell>
    );
  }

  return (
    <TelegramShell
      title={contact.name}
      subtitle={`${contact.relation} · ${chat.title} · ${authStatus?.authState.replaceAll("_", " ") ?? "unknown auth state"}`}
      connectionState={connectionState}
    >
      <TelegramGrid>
        <TelegramCard
          label="Back"
          subtitle="Return to the approved contact grid."
          icon={<ArrowLeft className="size-5" />}
          href="/messaging/chats"
        />
        <TelegramCard
          label="Retry"
          subtitle="Regenerate AI suggestions from the latest 20 Telegram messages."
          icon={retrying ? <LoaderCircle className="size-5 animate-spin" /> : <RefreshCcw className="size-5" />}
          onClick={handleRetry}
          disabled={retrying}
          meta="AI replies"
        />
        <ChatPreviewCard messages={messages} onOpen={openHistoryModal} />

        {replySlots.map((option, index) =>
          option ? (
            <TelegramCard
              key={option.id}
              label={option.label}
              subtitle={option.text}
              icon={
                busyReplyId === option.id ? (
                  <LoaderCircle className="size-5 animate-spin" />
                ) : (
                  <Bot className="size-5" />
                )
              }
              onClick={() => void handleSendReply(option)}
              disabled={busyReplyId !== null}
              meta={option.source}
              className="border-cyan-400/25 bg-cyan-400/5"
            />
          ) : (
            <TelegramCard
              key={`ai-placeholder-${index}`}
              label="No Reply Yet"
              subtitle="AI suggestions are unavailable right now. Retry to regenerate them."
              icon={<Send className="size-5" />}
              disabled
              meta="ai-telegram"
            />
          ),
        )}
      </TelegramGrid>

      {notice ? (
        <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}
      <HistoryModal
        open={historyOpen}
        messages={messages}
        currentPage={historyPage}
        onBack={() => setHistoryPage((previous) => Math.max(0, previous - 1))}
        onNext={() => setHistoryPage((previous) => Math.min(historyTotalPages - 1, previous + 1))}
        onClose={() => setHistoryOpen(false)}
      />
    </TelegramShell>
  );
}
