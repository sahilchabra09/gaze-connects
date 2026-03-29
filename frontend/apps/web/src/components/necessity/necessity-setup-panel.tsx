"use client";

import Link from "next/link";
import { LoaderCircle, Save, SquarePen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { necessityClient } from "@/lib/necessity/client";
import type { Necessity, NecessityInput } from "@/lib/necessity/types";
import { isNecessityRequestError } from "@/lib/necessity/types";
import { toSvgDataUri } from "@/lib/necessity/svg";
import { telegramClient } from "@/lib/telegram/client";
import type { TelegramContact } from "@/lib/telegram/types";
import { isTelegramRequestError } from "@/lib/telegram/types";

type NecessityFormState = {
  label: string;
  internalMessage: string;
  svgMarkup: string;
  isActive: boolean;
  sortOrder: string;
};

const DEFAULT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none">
  <rect x="14" y="14" width="92" height="92" rx="28" fill="#18181B" stroke="#A1A1AA" stroke-width="6"/>
  <path d="M60 34v52" stroke="#FAFAFA" stroke-width="10" stroke-linecap="round"/>
  <path d="M36 60h48" stroke="#FAFAFA" stroke-width="10" stroke-linecap="round"/>
</svg>`;

const EMPTY_FORM: NecessityFormState = {
  label: "",
  internalMessage: "",
  svgMarkup: DEFAULT_SVG,
  isActive: true,
  sortOrder: "",
};

function toFormState(necessity?: Necessity | null): NecessityFormState {
  if (!necessity) {
    return EMPTY_FORM;
  }

  return {
    label: necessity.label,
    internalMessage: necessity.internalMessage,
    svgMarkup: necessity.svgMarkup,
    isActive: necessity.isActive,
    sortOrder: String(necessity.sortOrder),
  };
}

function sortNecessities(necessities: Necessity[]) {
  return [...necessities].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    return left.label.localeCompare(right.label);
  });
}

export function NecessitySetupPanel() {
  const [necessities, setNecessities] = useState<Necessity[]>([]);
  const [contacts, setContacts] = useState<TelegramContact[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<NecessityFormState>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setIsLoading(true);
      setError("");

      try {
        const [nextNecessities, nextContacts] = await Promise.all([
          necessityClient.list(),
          telegramClient.listContacts().catch((requestError) => {
            if (isTelegramRequestError(requestError)) {
              return [];
            }

            throw requestError;
          }),
        ]);

        if (cancelled) {
          return;
        }

        setNecessities(nextNecessities);
        setContacts(nextContacts);
      } catch (requestError) {
        if (cancelled) {
          return;
        }

        setError(
          isNecessityRequestError(requestError)
            ? requestError.message
            : "Could not load necessity settings.",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  const sortedNecessities = useMemo(() => sortNecessities(necessities), [necessities]);
  const activeCaretaker = useMemo(
    () => contacts.find((contact) => contact.role === "caretaker" && contact.isActive) ?? null,
    [contacts],
  );

  function resetForm() {
    setEditingId(null);
    setFormState(EMPTY_FORM);
  }

  async function handleSave() {
    if (!formState.label.trim() || !formState.internalMessage.trim() || !formState.svgMarkup.trim()) {
      setError("Label, internal message, and SVG markup are required.");
      setMessage("");
      return;
    }

    if (formState.sortOrder.trim() && Number.isNaN(Number(formState.sortOrder))) {
      setError("Sort order must be numeric when provided.");
      setMessage("");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    const payload: NecessityInput = {
      label: formState.label.trim(),
      internalMessage: formState.internalMessage.trim(),
      svgMarkup: formState.svgMarkup.trim(),
      isActive: formState.isActive,
      ...(formState.sortOrder.trim() ? { sortOrder: Number(formState.sortOrder) } : {}),
    };

    try {
      const nextNecessity = editingId
        ? await necessityClient.update(editingId, payload)
        : await necessityClient.create(payload);

      setNecessities((previous) => {
        const next = new Map(previous.map((necessity) => [necessity.id, necessity]));
        next.set(nextNecessity.id, nextNecessity);
        return Array.from(next.values());
      });
      setMessage(editingId ? "Necessity updated." : "Necessity created.");
      resetForm();
    } catch (requestError) {
      setError(
        isNecessityRequestError(requestError)
          ? requestError.message
          : "Necessity could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  const caretakerStatusTone = !activeCaretaker
    ? "border-amber-500/25 bg-amber-500/10 text-amber-100"
    : activeCaretaker.telegramChatId
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
      : "border-zinc-700/70 bg-zinc-900/70 text-zinc-300";

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_1.25fr]">
      <section className="space-y-5 rounded-2xl border border-zinc-800/80 bg-zinc-950/55 p-5 transition-colors hover:border-zinc-700/85 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-100">
              {editingId ? "Edit Necessity" : "Create Necessity"}
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              These cards appear on the patient necessity screen and send the internal message to the caretaker on click.
            </p>
          </div>

          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
            >
              Cancel
            </button>
          ) : null}
        </div>

        <div className={`rounded-xl border px-4 py-3 text-sm ${caretakerStatusTone}`}>
          {!activeCaretaker
            ? "No active caretaker is configured yet. Necessity delivery will stay blocked until one exists."
            : activeCaretaker.telegramChatId
              ? `Caretaker ready: ${activeCaretaker.name} is active and mapped to Telegram chat ${activeCaretaker.telegramChatId}.`
              : `Caretaker found: ${activeCaretaker.name} is active, but their Telegram chat is not mapped yet.`}
        </div>

        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href="/messaging/contacts"
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
          >
            Manage Contacts
          </Link>
          <Link
            href="/messaging/chats"
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
          >
            Resolve Telegram Chat
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-zinc-200">Label</span>
            <input
              value={formState.label}
              onChange={(event) => setFormState((previous) => ({ ...previous, label: event.target.value }))}
              placeholder="I need water"
              className="h-11 rounded-xl border border-zinc-700/70 bg-zinc-900/80 px-3 text-zinc-100 outline-none transition-all placeholder:text-zinc-500 focus:border-zinc-300 focus:ring-2 focus:ring-zinc-300/20"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm">
            <span className="text-zinc-200">Sort Order</span>
            <input
              value={formState.sortOrder}
              onChange={(event) => setFormState((previous) => ({ ...previous, sortOrder: event.target.value }))}
              placeholder="0"
              className="h-11 rounded-xl border border-zinc-700/70 bg-zinc-900/80 px-3 text-zinc-100 outline-none transition-all placeholder:text-zinc-500 focus:border-zinc-300 focus:ring-2 focus:ring-zinc-300/20"
            />
          </label>
        </div>

        <label className="flex flex-col gap-2 text-sm">
          <span className="text-zinc-200">Internal Telegram Message</span>
          <textarea
            value={formState.internalMessage}
            onChange={(event) =>
              setFormState((previous) => ({ ...previous, internalMessage: event.target.value }))
            }
            rows={3}
            placeholder="Patient needs water. Please come to assist."
            className="rounded-xl border border-zinc-700/70 bg-zinc-900/80 px-3 py-3 text-zinc-100 outline-none transition-all placeholder:text-zinc-500 focus:border-zinc-300 focus:ring-2 focus:ring-zinc-300/20"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm">
          <span className="text-zinc-200">SVG Markup</span>
          <textarea
            value={formState.svgMarkup}
            onChange={(event) => setFormState((previous) => ({ ...previous, svgMarkup: event.target.value }))}
            rows={7}
            className="rounded-xl border border-zinc-700/70 bg-zinc-900/80 px-3 py-3 font-mono text-xs text-zinc-100 outline-none transition-all placeholder:text-zinc-500 focus:border-zinc-300 focus:ring-2 focus:ring-zinc-300/20"
          />
        </label>

        <label className="inline-flex items-center gap-3 rounded-xl border border-zinc-700/70 bg-zinc-900/80 px-4 py-3 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={formState.isActive}
            onChange={(event) => setFormState((previous) => ({ ...previous, isActive: event.target.checked }))}
            className="size-4 rounded border-zinc-500 bg-transparent"
          />
          Active necessity
        </label>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Preview</p>
          <div className="mt-4 flex items-center gap-4 rounded-2xl border border-zinc-700/60 bg-zinc-900 p-4">
            <img
              src={toSvgDataUri(formState.svgMarkup)}
              alt=""
              className="size-16 shrink-0 rounded-2xl bg-black/30 p-2"
            />
            <div>
              <p className="text-lg font-semibold text-zinc-100">{formState.label || "Necessity label"}</p>
              <p className="mt-1 text-sm text-zinc-400 line-clamp-2">
                {formState.internalMessage || "Internal message preview"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-100 px-5 py-2 text-sm font-semibold text-black transition hover:bg-white disabled:opacity-60"
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            {editingId ? "Save Changes" : "Create Necessity"}
          </button>

          <button
            type="button"
            onClick={() => setFormState((previous) => ({ ...previous, svgMarkup: DEFAULT_SVG }))}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
          >
            <SquarePen className="size-4" />
            Use Sample SVG
          </button>
        </div>

        {message ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}
      </section>

      <section className="space-y-5 rounded-2xl border border-zinc-800/80 bg-zinc-950/55 p-5 transition-colors hover:border-zinc-700/85 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-2xl font-semibold text-zinc-100">Saved Necessities</h3>
            <p className="mt-2 text-sm text-zinc-400">
              Order controls how the cards appear on the patient page.
            </p>
          </div>
          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300">
            {sortedNecessities.length} total
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 px-4 py-4 text-sm text-zinc-300">
            <LoaderCircle className="size-4 animate-spin" />
            Loading necessity settings...
          </div>
        ) : null}

        <div className="space-y-3">
          {sortedNecessities.map((necessity) => (
            <button
              key={necessity.id}
              type="button"
              onClick={() => {
                setEditingId(necessity.id);
                setFormState(toFormState(necessity));
                setError("");
                setMessage("");
              }}
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 text-left transition hover:border-zinc-600 hover:bg-zinc-900/80"
            >
              <div className="flex items-start gap-4">
                <img
                  src={toSvgDataUri(necessity.svgMarkup)}
                  alt=""
                  className="size-16 shrink-0 rounded-2xl bg-black/30 p-2"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-lg font-semibold text-zinc-100">{necessity.label}</p>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${
                        necessity.isActive
                          ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                          : "border border-zinc-700 bg-zinc-900 text-zinc-400"
                      }`}
                    >
                      {necessity.isActive ? "active" : "inactive"}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-zinc-400">{necessity.internalMessage}</p>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
                    <span>Order {necessity.sortOrder}</span>
                    <span>Updated {new Date(necessity.updatedAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </button>
          ))}

          {!isLoading && !sortedNecessities.length ? (
            <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/70 px-4 py-5 text-sm text-zinc-400">
              No necessities created yet. Add one on the left to populate the patient page.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
