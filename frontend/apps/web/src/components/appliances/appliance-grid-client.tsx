"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  ArrowLeft,
  Circle,
  LoaderCircle,
  Power,
  TriangleAlert,
} from "lucide-react";
import { testEyeTrackerStorage } from "@workspace/ui/lib/gaze-core-widget-storage";
import { useGazeCoreSetupWidget, type LivePreviewPoint } from "@workspace/ui/hooks/use-gaze-core-setup";

import { useMockMode } from "@/hooks/use-mock-mode";
import { applianceClient } from "@/lib/appliances/client";
import {
  AppliancePinName,
  AppliancePinState,
  isApplianceRequestError,
} from "@/lib/appliances/types";
import { authBaseURL, useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const DEFAULT_APPLIANCE_PAYLOAD = {
  pins: {
    d0: "off",
    d1: "off",
    d2: "off",
    d3: "off",
    d4: "on",
    d5: "off",
    d6: "off",
    d7: "on",
    d8: "on",
  },
  password: "abc",
} as const;

const APPLIANCE_CARDS = [
  { id: "appliance-1", label: "Appliance 1", pin: "d1" },
  { id: "appliance-2", label: "Appliance 2", pin: "d2" },
  { id: "appliance-3", label: "Appliance 3", pin: "d3" },
  { id: "appliance-4", label: "Appliance 4", pin: "d4" },
  { id: "appliance-5", label: "Appliance 5", pin: "d5" },
  { id: "appliance-6", label: "Appliance 6", pin: "d6" },
  { id: "appliance-7", label: "Appliance 7", pin: "d7" },
  { id: "appliance-8", label: "Appliance 8", pin: "d8" },
] as const;

type ApplianceCard = (typeof APPLIANCE_CARDS)[number];

function readCalibrationReady() {
  try {
    const record = testEyeTrackerStorage.readCalibrationRecord();
    return Boolean(record?.calibration);
  } catch {
    return false;
  }
}

function isPinOn(state: AppliancePinState) {
  return state === "on";
}

function toStatusLabel(state: AppliancePinState) {
  return isPinOn(state) ? "ON" : "OFF";
}

function toNextPinState(state: AppliancePinState): AppliancePinState {
  return isPinOn(state) ? "off" : "on";
}

function resolveGazeConnectBackendUrl() {
  const explicitUrl = process.env.NEXT_PUBLIC_GAZE_CONNECT_BACKEND_URL?.trim();
  if (explicitUrl) {
    return explicitUrl.replace(/\/+$/g, "");
  }

  return authBaseURL ?? "";
}

export function ApplianceGridClient() {
  const { mockEnabled, requiresCalibration, setMockModeState } = useMockMode();
  const router = useRouter();
  const { data: session } = useSession();
  const [cursorPosition, setCursorPosition] = useState({ x: -100, y: -100 });
  const [calibrationReady, setCalibrationReady] = useState(readCalibrationReady);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [showCalibrationAlert, setShowCalibrationAlert] = useState(false);
  const [pinStates, setPinStates] = useState<Record<AppliancePinName, AppliancePinState>>({
    ...DEFAULT_APPLIANCE_PAYLOAD.pins,
  });
  const [pendingPin, setPendingPin] = useState<AppliancePinName | null>(null);
  const [message, setMessage] = useState("Tap a card to send the shared appliance JSON.");
  const [error, setError] = useState("");

  const gazeConnectBackendUrl = useMemo(() => resolveGazeConnectBackendUrl(), []);
  const gazeControlEnabled = !mockEnabled && calibrationReady;

  const handleLivePreviewPoint = useCallback((point: LivePreviewPoint | null) => {
    if (!point) {
      return;
    }

    setCursorPosition({ x: point.x, y: point.y });
  }, []);

  const gazeState = useGazeCoreSetupWidget({
    backendBaseUrl: gazeConnectBackendUrl,
    onLivePreviewPoint: handleLivePreviewPoint,
  });

  const cardById = useMemo(() => {
    const map = new Map<string, ApplianceCard>();
    for (const card of APPLIANCE_CARDS) {
      map.set(card.id, card);
    }
    return map;
  }, []);

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
    if (mockEnabled) {
      return;
    }

    if (calibrationReady) {
      return;
    }

    setMockModeState({
      mockEnabled: true,
      requiresCalibration: false,
    });
  }, [calibrationReady, mockEnabled, setMockModeState]);

  useEffect(() => {
    if (!mockEnabled) {
      return;
    }

    const updateCursorPosition = (event: MouseEvent) => {
      setCursorPosition({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener("mousemove", updateCursorPosition);

    return () => {
      window.removeEventListener("mousemove", updateCursorPosition);
    };
  }, [mockEnabled]);

  useEffect(() => {
    if (gazeControlEnabled) {
      return;
    }

    gazeState.stopLivePreview();
    gazeState.closePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gazeControlEnabled]);

  useEffect(() => {
    if (!gazeControlEnabled || gazeState.previewActive) {
      return;
    }

    void gazeState.openPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gazeControlEnabled, gazeState.previewActive]);

  useEffect(() => {
    if (!gazeControlEnabled || !gazeState.previewActive || gazeState.livePreviewActive) {
      return;
    }

    void gazeState.startLivePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gazeControlEnabled, gazeState.livePreviewActive, gazeState.previewActive]);

  useEffect(() => {
    if (!gazeControlEnabled) {
      setActiveCardId(null);
      return;
    }

    const element = document.elementFromPoint(cursorPosition.x, cursorPosition.y);
    const cardElement = element?.closest<HTMLElement>("[data-appliance-card-id]");
    setActiveCardId(cardElement?.dataset.applianceCardId ?? null);
  }, [cursorPosition, gazeControlEnabled]);

  const handleToggleAppliance = useCallback(async (card: ApplianceCard) => {
    if (pendingPin) {
      return;
    }

    const currentState = pinStates[card.pin];
    const nextState = toNextPinState(currentState);
    const nextPins = {
      ...pinStates,
      [card.pin]: nextState,
    };

    setPendingPin(card.pin);
    setError("");
    setMessage(`Sending ${card.label} ${toStatusLabel(nextState)}...`);

    try {
      await applianceClient.control({
        password: DEFAULT_APPLIANCE_PAYLOAD.password,
        pins: nextPins,
      });

      setPinStates(nextPins);
      setMessage(`${card.label} is now ${toStatusLabel(nextState)}.`);
    } catch (requestError) {
      setError(
        isApplianceRequestError(requestError)
          ? requestError.message
          : `Could not update ${card.label}.`,
      );
      setMessage("");
    } finally {
      setPendingPin(null);
    }
  }, [pendingPin, pinStates]);

  useEffect(() => {
    if (!gazeControlEnabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTypingContext = target && (
        target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.tagName === "SELECT"
        || target.isContentEditable
      );
      if (isTypingContext) {
        return;
      }

      event.preventDefault();

      const selectedCard = activeCardId ? cardById.get(activeCardId) : null;
      if (!selectedCard) {
        return;
      }

      void handleToggleAppliance(selectedCard);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeCardId, cardById, gazeControlEnabled, handleToggleAppliance]);

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

      <div className="h-[calc(100vh-140px)] w-full px-5 pb-4 pt-6 md:px-8">
        <header className="mb-5 flex items-center justify-between gap-4 md:mb-6">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Appliance Control</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100 md:text-3xl">
              Appliances
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              All 8 cards send the same JSON payload and toggle only their own appliance pin.
            </p>
          </div>

          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-100 transition-all hover:border-zinc-500 hover:bg-zinc-800"
          >
            <ArrowLeft className="size-4" />
            Home
          </Link>
        </header>

        <section className="grid h-[calc(100%-5.5rem)] auto-rows-fr grid-cols-2 gap-4 xl:grid-cols-4">
          {APPLIANCE_CARDS.map((card) => {
            const state = pinStates[card.pin];
            const isOn = isPinOn(state);
            const isPending = pendingPin === card.pin;
            const isDisabled = pendingPin !== null;
            const isGazeFocused = gazeControlEnabled && activeCardId === card.id;

            return (
              <button
                key={card.id}
                type="button"
                onClick={() => void handleToggleAppliance(card)}
                disabled={isDisabled}
                data-appliance-card-id={card.id}
                className={cn(
                  "relative flex h-full min-h-[170px] w-full flex-col items-center justify-center gap-4 rounded-3xl border p-5 text-center shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-all duration-300",
                  isOn
                    ? "border-emerald-400/60 bg-emerald-500/10"
                    : "border-zinc-700/50 bg-zinc-950",
                  isGazeFocused && "border-cyan-300 bg-zinc-900 shadow-[0_0_24px_rgba(34,211,238,0.28)]",
                  isDisabled
                    ? "cursor-not-allowed opacity-70"
                    : "cursor-pointer hover:-translate-y-0.5 hover:border-zinc-400/85 hover:bg-zinc-900",
                )}
              >
                {isPending ? (
                  <LoaderCircle className="size-10 animate-spin text-zinc-100/95" />
                ) : (
                  <Power className={cn("size-10", isOn ? "text-emerald-300" : "text-zinc-100/95")} />
                )}

                <span className="text-2xl font-medium tracking-tight text-zinc-100/95 md:text-3xl">
                  {card.label}
                </span>

                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span className="rounded-full border border-zinc-700 bg-black/25 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
                    {card.pin.toUpperCase()}
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
                      isOn
                        ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
                        : "border-zinc-700 bg-zinc-900/70 text-zinc-400",
                    )}
                  >
                    {toStatusLabel(state)}
                  </span>
                </div>
              </button>
            );
          })}
        </section>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-20 flex justify-center px-4">
        <div
          className={cn(
            "pointer-events-auto flex max-w-3xl items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-xl backdrop-blur-sm",
            error
              ? "border-red-500/20 bg-red-500/10 text-red-200"
              : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
          )}
        >
          {pendingPin ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : error ? (
            <TriangleAlert className="size-4" />
          ) : (
            <Circle className="size-4 fill-current" />
          )}
          <span>{error || message}</span>
        </div>
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
                : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100",
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
