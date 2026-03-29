"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type TelegramGridProps = {
  children: ReactNode;
  className?: string;
};

type TelegramCardProps = {
  label: string;
  subtitle?: string;
  meta?: string;
  badge?: string | number;
  icon?: ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  tone?: "default" | "muted" | "danger";
  className?: string;
};

const toneClasses: Record<NonNullable<TelegramCardProps["tone"]>, string> = {
  default: "border-zinc-700/50 bg-zinc-950 hover:border-zinc-400/85 hover:bg-zinc-900",
  muted: "border-zinc-700/30 bg-zinc-950/80 hover:border-zinc-500/70 hover:bg-zinc-900",
  danger: "border-red-500/35 bg-red-950/30 hover:border-red-400/65 hover:bg-red-950/45",
};

export function TelegramGrid({ children, className }: TelegramGridProps) {
  return (
    <section className={cn("grid h-full auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3", className)}>
      {children}
    </section>
  );
}

function TelegramCardBody({
  label,
  subtitle,
  meta,
  badge,
  icon,
}: Pick<TelegramCardProps, "label" | "subtitle" | "meta" | "badge" | "icon">) {
  return (
    <>
      {meta || badge ? (
        <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-3">
          <span className="min-h-6 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            {meta ?? ""}
          </span>
          {badge !== undefined ? (
            <span className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/15 px-2 text-xs font-semibold text-cyan-100">
              {badge}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-1 flex-col items-center justify-center gap-5">
      {icon ? (
        <div className="text-zinc-100/95 [&_svg]:size-9">
          {icon}
        </div>
      ) : null}

        <div className="space-y-2">
          <p className="text-center text-4xl font-medium tracking-tight text-zinc-100/95 md:text-5xl">{label}</p>
          {subtitle ? (
            <p className="mx-auto max-w-72 text-center text-sm leading-5 text-zinc-400">{subtitle}</p>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function TelegramCard({
  label,
  subtitle,
  meta,
  badge,
  icon,
  href,
  onClick,
  disabled,
  active,
  tone = "default",
  className,
}: TelegramCardProps) {
  const cardClasses = cn(
    "relative flex h-full min-h-[170px] w-full flex-col items-center justify-center gap-5 rounded-3xl border p-5 text-center shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-all duration-300",
    toneClasses[tone],
    active && "border-zinc-200/80 bg-zinc-100 text-black shadow-[0_0_24px_rgba(255,255,255,0.16)]",
    disabled && "cursor-not-allowed opacity-55 hover:border-inherit hover:bg-inherit",
    !disabled && "hover:-translate-y-0.5",
    className,
  );

  const content = (
    <TelegramCardBody label={label} subtitle={subtitle} meta={meta} badge={badge} icon={icon} />
  );

  if (href && !disabled) {
    return (
      <Link href={href} className={cardClasses}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cardClasses} disabled={disabled}>
        {content}
      </button>
    );
  }

  return <div className={cardClasses}>{content}</div>;
}
