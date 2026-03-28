import Link from "next/link";

type OptionPageProps = {
  params: Promise<{ mode: string; option: string }>;
};

function formatLabel(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function OptionPage({ params }: OptionPageProps) {
  const { mode, option } = await params;

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-4 text-zinc-100">
      <div className="w-full max-w-xl rounded-3xl border border-zinc-700/80 bg-zinc-950/90 p-8 text-center shadow-2xl">
        <p className="text-sm uppercase tracking-[0.22em] text-zinc-500">Mock Screen</p>
        <h1 className="mt-3 text-3xl font-semibold text-white">
          {formatLabel(mode)} — Option {option}
        </h1>
        <p className="mt-3 text-zinc-400">This is a placeholder route for now.</p>

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            href={`/${mode}`}
            className="rounded-xl border border-zinc-600 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-100 transition-all hover:border-zinc-400"
          >
            Back to {formatLabel(mode)}
          </Link>
          <Link
            href="/"
            className="rounded-xl border border-violet-500/70 bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-violet-500"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
