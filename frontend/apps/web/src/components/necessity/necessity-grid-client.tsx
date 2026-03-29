"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  LoaderCircle,
  PhoneCall,
  Send,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { TelegramShell } from "@/components/telegram/telegram-shell";
import { useTelegramEvents } from "@/hooks/use-telegram-events";
import { useSession } from "@/lib/auth-client";
import { necessityClient } from "@/lib/necessity/client";
import type {
  Necessity,
  NecessityRequest,
  NecessityRequestEventData,
  NecessityTriggerResponse,
} from "@/lib/necessity/types";
import { isNecessityRequestError } from "@/lib/necessity/types";
import { toSvgDataUri } from "@/lib/necessity/svg";

type NecessityGridClientProps = {
  initialNecessities: Necessity[];
  initialError: { status: number; code: string; message: string } | null;
};

const NECESSITIES_PER_PAGE = 4;

type ActiveRequestState = {
  id: string;
  necessityId: string;
  status: NecessityRequest["status"];
  triggeredAt: string;
  escalateAfterSeconds: number;
};

function toActiveRequestState(response: NecessityTriggerResponse): ActiveRequestState {
  return {
    id: response.id,
    necessityId: response.necessityId,
    status: response.status,
    triggeredAt: response.triggeredAt,
    escalateAfterSeconds: response.escalateAfterSeconds,
  };
}

function speakLabel(label: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(label);
  utterance.rate = 0.92;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function cardClassName(disabled = false) {
  return `relative flex min-h-[170px] w-full flex-col items-center justify-center gap-5 rounded-3xl border border-zinc-700/50 bg-zinc-950 p-5 text-center shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-all duration-300 ${
    disabled
      ? "cursor-not-allowed opacity-55"
      : "hover:-translate-y-0.5 hover:border-zinc-400/85 hover:bg-zinc-900"
  }`;
}

function BackCard() {
  return (
    <Link href="/" className={cardClassName(false)}>
      <ArrowLeft className="size-9 text-zinc-100/95" />
      <span className="text-4xl font-medium tracking-tight text-zinc-100/95 md:text-5xl">Back</span>
    </Link>
  );
}

export function NecessityGridClient({ initialNecessities, initialError }: NecessityGridClientProps) {
  const { data: session, isPending: sessionPending } = useSession();
  const [necessities, setNecessities] = useState(initialNecessities);
  const [page, setPage] = useState(0);
  const [activeRequest, setActiveRequest] = useState<ActiveRequestState | null>(null);
  const [busyNecessityId, setBusyNecessityId] = useState<string | null>(null);
  const [error, setError] = useState(initialError?.status === 401 ? "" : (initialError?.message ?? ""));
  const [message, setMessage] = useState("");
  const [appAuthRequired, setAppAuthRequired] = useState(initialError?.status === 401);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const totalPages = Math.max(1, Math.ceil(necessities.length / NECESSITIES_PER_PAGE));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleNecessities = useMemo(
    () =>
      necessities.slice(
        currentPage * NECESSITIES_PER_PAGE,
        currentPage * NECESSITIES_PER_PAGE + NECESSITIES_PER_PAGE,
      ),
    [necessities, currentPage],
  );

  const connectionState = useTelegramEvents({
    necessity_request_acknowledged: (event: NecessityRequestEventData) => {
      if (event.request.id !== activeRequest?.id) {
        return;
      }

      setActiveRequest((previous) => (previous ? { ...previous, status: "acknowledged" } : previous));
      setBusyNecessityId(null);
      setMessage(`Caretaker replied to "${event.request.labelSnapshot}".`);
      setError("");
    },
    necessity_request_escalated: (event: NecessityRequestEventData) => {
      if (event.request.id !== activeRequest?.id) {
        return;
      }

      setActiveRequest((previous) => (previous ? { ...previous, status: "escalated" } : previous));
      setBusyNecessityId(null);
      setMessage(`No reply in time. Dummy caretaker call triggered for "${event.request.labelSnapshot}".`);
      setError("");
    },
  });

  useEffect(() => {
    if (!activeRequest || activeRequest.status === "pending") {
      return;
    }

    const timeout = window.setTimeout(() => {
      setActiveRequest(null);
      setMessage("");
    }, 4000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [activeRequest]);

  useEffect(() => {
    if (sessionPending) {
      return;
    }

    if (!session?.user?.id) {
      setNecessities([]);
      setAppAuthRequired(true);
      setError("Sign in required");
      setMessage("");
      setIsRefreshing(false);
      return;
    }

    let cancelled = false;

    async function refreshNecessities() {
      setAppAuthRequired(false);
      setError("");
      setIsRefreshing(true);

      try {
        const nextNecessities = await necessityClient.listActive();
        if (cancelled) {
          return;
        }

        setNecessities(nextNecessities);
        setAppAuthRequired(false);
        setError("");
      } catch (requestError) {
        if (cancelled) {
          return;
        }

        setNecessities([]);
        setAppAuthRequired(
          isNecessityRequestError(requestError) && requestError.status === 401,
        );
        setError(
          isNecessityRequestError(requestError)
            ? requestError.message
            : "Could not load necessities.",
        );
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    }

    void refreshNecessities();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, sessionPending]);

  async function handleTrigger(necessity: Necessity) {
    setBusyNecessityId(necessity.id);
    setError("");
    setMessage(`Sending "${necessity.label}" to the caretaker...`);
    speakLabel(necessity.label);

    try {
      const response = await necessityClient.trigger(necessity.id);
      setActiveRequest(toActiveRequestState(response));
      setMessage(`"${necessity.label}" sent. Waiting ${response.escalateAfterSeconds} seconds for a caretaker reply.`);
    } catch (requestError) {
      setError(
        isNecessityRequestError(requestError)
          ? requestError.message
          : `Could not send "${necessity.label}".`,
      );
      setMessage("");
      setActiveRequest(null);
    } finally {
      setBusyNecessityId(null);
    }
  }

  const cardsDisabled = Boolean(activeRequest && activeRequest.status === "pending");

  return (
    <TelegramShell title="Necessity" subtitle="Patient necessities" connectionState={connectionState}>
      <div className="h-full space-y-4">
        <section className="grid h-[calc(100%-4rem)] auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <BackCard />

          {appAuthRequired ? (
            <>
              <Link href="/auth" className={cardClassName(false)}>
                <ShieldAlert className="size-9 text-zinc-100/95" />
                <span className="text-4xl font-medium tracking-tight text-zinc-100/95 md:text-5xl">Sign In</span>
              </Link>
              <Link href="/setup" className={cardClassName(false)}>
                <Send className="size-9 text-zinc-100/95" />
                <span className="text-4xl font-medium tracking-tight text-zinc-100/95 md:text-5xl">Setup</span>
              </Link>
              <div className={cardClassName(true)}>
                <ShieldAlert className="size-9 text-zinc-100/95" />
                <span className="text-2xl font-medium tracking-tight text-zinc-100/95 md:text-3xl">
                  Sign in to load necessities
                </span>
              </div>
            </>
          ) : isRefreshing && necessities.length === 0 ? (
            <>
              <div className={cardClassName(true)}>
                <LoaderCircle className="size-9 animate-spin text-zinc-100/95" />
                <span className="text-2xl font-medium tracking-tight text-zinc-100/95 md:text-3xl">
                  Loading necessities
                </span>
              </div>
              {Array.from({ length: NECESSITIES_PER_PAGE - 1 }).map((_, index) => (
                <div key={`loading-${index}`} className={cardClassName(true)}>
                  <LoaderCircle className="size-9 animate-spin text-zinc-100/40" />
                  <span className="text-3xl font-medium tracking-tight text-zinc-100/40 md:text-4xl">
                    Loading
                  </span>
                </div>
              ))}
            </>
          ) : (
            <>
              {visibleNecessities.map((necessity) => (
                <button
                  key={necessity.id}
                  type="button"
                  onClick={() => void handleTrigger(necessity)}
                  disabled={cardsDisabled || busyNecessityId !== null}
                  className={cardClassName(cardsDisabled || busyNecessityId !== null)}
                >
                  {busyNecessityId === necessity.id ? (
                    <LoaderCircle className="size-9 animate-spin text-zinc-100/95" />
                  ) : (
                    <img
                      src={toSvgDataUri(necessity.svgMarkup)}
                      alt=""
                      className="size-20 rounded-[1.35rem] bg-black/25 p-3"
                    />
                  )}
                  <span className="text-4xl font-medium tracking-tight text-zinc-100/95 md:text-5xl">
                    {necessity.label}
                  </span>
                </button>
              ))}

              {Array.from({ length: Math.max(0, NECESSITIES_PER_PAGE - visibleNecessities.length) }).map((_, index) => (
                <div key={`empty-${index}`} className={cardClassName(true)}>
                  <span className="text-4xl font-medium tracking-tight text-zinc-100/95 md:text-5xl">Empty</span>
                </div>
              ))}
            </>
          )}

          <button
            type="button"
            onClick={() => setPage((previous) => Math.min(totalPages - 1, previous + 1))}
            disabled={currentPage >= totalPages - 1 || appAuthRequired}
            className={cardClassName(currentPage >= totalPages - 1 || appAuthRequired)}
          >
            <ArrowRight className="size-9 text-zinc-100/95" />
            <span className="text-4xl font-medium tracking-tight text-zinc-100/95 md:text-5xl">Next</span>
            <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Page {currentPage + 1} of {totalPages}
            </span>
          </button>
        </section>

        {(message || error || activeRequest?.status === "pending") && (
          <div
            className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${
              error
                ? "border-red-500/20 bg-red-500/10 text-red-200"
                : activeRequest?.status === "escalated"
                  ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
                  : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
            }`}
          >
            {activeRequest?.status === "pending" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : activeRequest?.status === "escalated" ? (
              <PhoneCall className="size-4" />
            ) : (
              <CheckCheck className="size-4" />
            )}
            <span>{error || message}</span>
          </div>
        )}

        {currentPage > 0 && !appAuthRequired ? (
          <div className="flex justify-start">
            <button
              type="button"
              onClick={() => setPage((previous) => Math.max(0, previous - 1))}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
            >
              Previous Page
            </button>
          </div>
        ) : null}
      </div>
    </TelegramShell>
  );
}
