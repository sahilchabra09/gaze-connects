"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  ArrowLeft,
  ArrowRight,
  Circle,
  House,
  MessageSquare,
  Mic,
  Phone,
  TriangleAlert,
  Sparkles,
  Zap,
} from "lucide-react";
import { testEyeTrackerStorage } from "@workspace/ui/lib/gaze-core-widget-storage";
import { useGazeCoreSetupWidget, type LivePreviewPoint } from "@workspace/ui/hooks/use-gaze-core-setup";

import { useMockMode } from "@/hooks/use-mock-mode";
import { authBaseURL, useSession } from "@/lib/auth-client";
import type { GridCard, GridIcon } from "@/lib/mode-navigation";
import { cn } from "@/lib/utils";

type ModeGridScreenProps = {
  cards: GridCard[];
  title?: string;
  subtitle?: string;
};

function readCalibrationReady() {
  try {
    const record = testEyeTrackerStorage.readCalibrationRecord();
    return Boolean(record?.calibration);
  } catch {
    return false;
  }
}

function getIcon(icon: GridIcon) {
  const className = "size-9 text-zinc-100/95";

  switch (icon) {
    case "back":
      return <ArrowLeft className={className} />;
    case "next":
      return <ArrowRight className={className} />;
    case "appliances":
      return <House className={className} />;
    case "necessity":
      return <Zap className={className} />;
    case "messaging":
      return <MessageSquare className={className} />;
    case "calling":
      return <Phone className={className} />;
    case "talk-live":
      return <Mic className={className} />;
    case "option":
      return <Sparkles className={className} />;
    default:
      return <Circle className={className} />;
  }
}

export function ModeGridScreen({ cards, title, subtitle }: ModeGridScreenProps) {
  const { mockEnabled, requiresCalibration, setMockModeState } = useMockMode();
  const router = useRouter();
  const { data: session } = useSession();
  const hasHeader = Boolean(title || subtitle);
  const [cursorPosition, setCursorPosition] = useState({ x: -100, y: -100 });
  const [calibrationReady, setCalibrationReady] = useState(readCalibrationReady);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [showCalibrationAlert, setShowCalibrationAlert] = useState(false);

  const gazeConnectBackendUrl = useMemo(() => {
    const explicitUrl = process.env.NEXT_PUBLIC_GAZE_CONNECT_BACKEND_URL?.trim();
    if (explicitUrl) {
      return explicitUrl.replace(/\/+$/g, "");
    }

    return authBaseURL ?? "";
  }, []);

  const handleLivePreviewPoint = useCallback((point: LivePreviewPoint | null) => {
    if (!point) return;
    setCursorPosition({ x: point.x, y: point.y });
  }, []);

  const gazeState = useGazeCoreSetupWidget({
    backendBaseUrl: gazeConnectBackendUrl,
    onLivePreviewPoint: handleLivePreviewPoint,
  });

  const cardById = useMemo(() => {
    const map = new Map<string, GridCard>();
    for (const card of cards) {
      map.set(card.id, card);
    }
    return map;
  }, [cards]);

  const gazeControlEnabled = !mockEnabled && calibrationReady;

  useEffect(() => {
    const syncCalibrationReady = () => {
      setCalibrationReady(readCalibrationReady());
    };

    syncCalibrationReady();
    window.addEventListener("storage", syncCalibrationReady);
    window.addEventListener("focus", syncCalibrationReady);

    return () => {
      window.removeEventListener("storage", syncCalibrationReady);
      window.removeEventListener("focus", syncCalibrationReady);
    };
  }, []);

  useEffect(() => {
    if (mockEnabled) return;
    if (calibrationReady) return;

    setMockModeState({
      mockEnabled: true,
      requiresCalibration: false,
    });
  }, [calibrationReady, mockEnabled, setMockModeState]);

  useEffect(() => {
    if (!mockEnabled) return;

    const updateCursorPosition = (event: MouseEvent) => {
      setCursorPosition({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener("mousemove", updateCursorPosition);

    return () => {
      window.removeEventListener("mousemove", updateCursorPosition);
    };
  }, [mockEnabled]);

  useEffect(() => {
    if (gazeControlEnabled) return;
    gazeState.stopLivePreview();
    gazeState.closePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gazeControlEnabled]);

  useEffect(() => {
    if (!gazeControlEnabled) return;
    if (gazeState.previewActive) return;
    void gazeState.openPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gazeControlEnabled, gazeState.previewActive]);

  useEffect(() => {
    if (!gazeControlEnabled) return;
    if (!gazeState.previewActive) return;
    if (gazeState.livePreviewActive) return;
    void gazeState.startLivePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gazeControlEnabled, gazeState.livePreviewActive, gazeState.previewActive]);

  useEffect(() => {
    if (!gazeControlEnabled) {
      setActiveCardId(null);
      return;
    }

    const element = document.elementFromPoint(cursorPosition.x, cursorPosition.y);
    const cardElement = element?.closest<HTMLElement>("[data-mode-card-id]");
    setActiveCardId(cardElement?.dataset.modeCardId ?? null);
  }, [cursorPosition, gazeControlEnabled]);

  useEffect(() => {
    if (!gazeControlEnabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;

      const target = event.target as HTMLElement | null;
      const isTypingContext = target && (
        target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.tagName === "SELECT"
        || target.isContentEditable
      );
      if (isTypingContext) return;

      event.preventDefault();

      const selected = activeCardId ? cardById.get(activeCardId) : null;
      if (!selected?.href) return;
      router.push(selected.href);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeCardId, cardById, gazeControlEnabled, router]);

  const handleToggleMockMode = () => {
    if (mockEnabled) {
      if (requiresCalibration || !calibrationReady) {
        setShowCalibrationAlert(true);
        return;
      }

      setMockModeState({
        mockEnabled: false,
        requiresCalibration: false,
      });
      return;
    }

    setMockModeState({
      mockEnabled: true,
      requiresCalibration: true,
    });
  };

  return (
    <main className={cn("relative h-screen w-screen overflow-hidden bg-black text-zinc-100", gazeControlEnabled && "cursor-none")}>
      {gazeControlEnabled && (
        <span
          className="pointer-events-none fixed z-50 block size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-300 bg-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.7)]"
          style={{
            left: cursorPosition.x,
            top: cursorPosition.y,
          }}
        />
      )}

      <div
        className={cn(
          "h-[calc(100vh-106px)] w-full px-5 pb-4 pt-6 md:px-8",
          hasHeader && "h-[calc(100vh-140px)]"
        )}
      >
        {(title || subtitle) && (
          <header className="mb-5 md:mb-6">
            {title && (
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-100 md:text-3xl">
                {title}
              </h1>
            )}
            {subtitle && <p className="mt-2 text-zinc-400">{subtitle}</p>}
          </header>
        )}

        <section className="grid h-full auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const isClickable = Boolean(card.href);
            const isGazeFocused = gazeControlEnabled && activeCardId === card.id;

            const cardClasses = cn(
              "relative flex h-full min-h-[170px] w-full flex-col items-center justify-center gap-5 rounded-3xl border border-zinc-700/50",
              "bg-zinc-950 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-all duration-300",
              isGazeFocused && "border-emerald-300/90 bg-zinc-900 shadow-[0_0_24px_rgba(16,185,129,0.35)]",
              isClickable
                ? "cursor-pointer hover:-translate-y-0.5 hover:border-zinc-400/85 hover:bg-zinc-900"
                : "cursor-not-allowed opacity-55"
            );

            const content = (
              <>
                {getIcon(card.icon)}
                <span className="text-4xl font-medium tracking-tight text-zinc-100/95 md:text-5xl">
                  {card.label}
                </span>
              </>
            );

            if (isClickable && card.href) {
              return (
                <Link key={card.id} href={card.href} className={cardClasses} data-mode-card-id={card.id}>
                  {content}
                </Link>
              );
            }

            return (
              <div key={card.id} className={cardClasses} aria-disabled data-mode-card-id={card.id}>
                {content}
              </div>
            );
          })}
        </section>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-zinc-700/70 bg-black/70 p-2 shadow-xl backdrop-blur-sm">
          <Link
            href="/setup?tab=calibration"
            className="inline-flex items-center rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
          >
            Setup
          </Link>

          <Link
            href="/auth"
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
          >
            <BadgeCheck className="size-4" />
            {session?.user?.name || "Auth"}
          </Link>

          <button
            type="button"
            onClick={handleToggleMockMode}
            className={cn(
              "inline-flex min-w-28 items-center justify-center rounded-xl px-5 py-2 text-sm font-semibold transition-all",
              mockEnabled
                ? "border border-zinc-300 bg-zinc-100 text-black shadow-[0_0_20px_rgba(255,255,255,0.25)]"
                : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
            )}
          >
            Mock: {mockEnabled ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {gazeControlEnabled && (
        <div className="pointer-events-none fixed left-4 top-4 z-40 rounded bg-black/70 px-3 py-2 text-sm text-white">
          <p>Live preview</p>
          <p className="text-xs text-white/70">Status: {gazeState.livePreviewStatus}</p>
          {gazeState.livePreviewError && (
            <p className="mt-1 text-xs text-red-300">{gazeState.livePreviewError}</p>
          )}
        </div>
      )}

      {showCalibrationAlert && (
        <div className="fixed inset-0 z-90 flex items-center justify-center bg-black/60 px-4 backdrop-blur-[1px]">
          <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
            <div className="mb-3 flex items-start gap-2 text-zinc-100">
              <TriangleAlert className="mt-0.5 size-5 text-amber-300" />
              <div>
                <p className="font-semibold">Calibration required</p>
                <p className="mt-1 text-sm text-zinc-300">
                  You have to calibrate first before turning mock mode off and using eye-tracker navigation.
                </p>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCalibrationAlert(false)}
                className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-zinc-500"
              >
                Later
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCalibrationAlert(false);
                  router.push("/setup?tab=calibration");
                }}
                className="rounded-xl border border-zinc-300 bg-zinc-100 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-white"
              >
                Open Calibration
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
