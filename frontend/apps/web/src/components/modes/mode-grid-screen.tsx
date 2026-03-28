"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BadgeCheck,
  ArrowLeft,
  ArrowRight,
  Circle,
  House,
  MessageSquare,
  Mic,
  Phone,
  Sparkles,
  Zap,
} from "lucide-react";

import { useMockMode } from "@/hooks/use-mock-mode";
import { useSession } from "@/lib/auth-client";
import type { GridCard, GridIcon } from "@/lib/mode-navigation";
import { cn } from "@/lib/utils";

type ModeGridScreenProps = {
  cards: GridCard[];
  title?: string;
  subtitle?: string;
};

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
  const { mockEnabled, toggleMockMode } = useMockMode(true);
  const { data: session } = useSession();
  const hasHeader = Boolean(title || subtitle);
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
            const isClickable = Boolean(mockEnabled && card.href);

            const cardClasses = cn(
              "relative flex h-full min-h-[170px] w-full flex-col items-center justify-center gap-5 rounded-3xl border border-zinc-700/50",
              "bg-zinc-950 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-all duration-300",
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
                <Link key={card.id} href={card.href} className={cardClasses}>
                  {content}
                </Link>
              );
            }

            return (
              <div key={card.id} className={cardClasses} aria-disabled>
                {content}
              </div>
            );
          })}
        </section>
      </div>

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
                : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
            )}
          >
            Mock: {mockEnabled ? "ON" : "OFF"}
          </button>
        </div>
      </div>
    </main>
  );
}
