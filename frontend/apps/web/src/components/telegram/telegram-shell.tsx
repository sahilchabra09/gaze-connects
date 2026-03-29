"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { BadgeCheck, TriangleAlert } from "lucide-react";
import { testEyeTrackerStorage } from "@workspace/ui/lib/gaze-core-widget-storage";

import { useMockMode } from "@/hooks/use-mock-mode";
import { useSession } from "@/lib/auth-client";
import type { TelegramLiveConnectionState } from "@/lib/telegram/types";
import { cn } from "@/lib/utils";

type TelegramShellProps = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  connectionState?: TelegramLiveConnectionState;
  actions?: ReactNode;
  children: ReactNode;
};

function readCalibrationReady() {
  try {
    const record = testEyeTrackerStorage.readCalibrationRecord();
    return Boolean(record?.calibration);
  } catch {
    return false;
  }
}

export function TelegramShell({
  children,
}: TelegramShellProps) {
  const { mockEnabled, requiresCalibration, setMockModeState } = useMockMode();
  const { data: session } = useSession();
  const router = useRouter();
  const [cursorPosition, setCursorPosition] = useState({ x: -100, y: -100 });
  const [calibrationReady, setCalibrationReady] = useState(readCalibrationReady);
  const [showCalibrationAlert, setShowCalibrationAlert] = useState(false);

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
    const updateCursorPosition = (event: MouseEvent) => {
      setCursorPosition({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener("mousemove", updateCursorPosition);
    return () => {
      window.removeEventListener("mousemove", updateCursorPosition);
    };
  }, []);

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
    <main className="relative h-screen w-screen overflow-hidden bg-black text-zinc-100">
      <span
        className="pointer-events-none fixed z-50 block size-3 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.95)]"
        style={{
          transform: `translate3d(${cursorPosition.x - 6}px, ${cursorPosition.y - 6}px, 0)`,
        }}
      />

      <div className="h-[calc(100vh-106px)] w-full px-5 pb-4 pt-6 md:px-8">
        <div className="h-full overflow-hidden pb-1 pr-1 pt-2">{children}</div>

        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-zinc-700/70 bg-black/70 p-2 shadow-xl backdrop-blur-sm">
            <Link
              href="/setup"
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
      </div>

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
