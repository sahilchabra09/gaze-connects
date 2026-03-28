"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { BadgeCheck } from "lucide-react";

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

export function TelegramShell({
  children,
}: TelegramShellProps) {
  const { mockEnabled, toggleMockMode } = useMockMode(true);
  const { data: session } = useSession();
  const [cursorPosition, setCursorPosition] = useState({ x: -100, y: -100 });

  useEffect(() => {
    const updateCursorPosition = (event: MouseEvent) => {
      setCursorPosition({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener("mousemove", updateCursorPosition);
    return () => {
      window.removeEventListener("mousemove", updateCursorPosition);
    };
  }, []);

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
              onClick={toggleMockMode}
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
    </main>
  );
}
