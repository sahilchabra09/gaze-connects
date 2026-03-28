"use client";

import Link from "next/link";
import {
  ArrowLeft,
  LoaderCircle,
  MessageSquareMore,
  Plus,
  Save,
  Trash2,
  UserRoundCog,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useTelegramEvents } from "@/hooks/use-telegram-events";
import { telegramClient } from "@/lib/telegram/client";
import type { TelegramAuthStatus, TelegramContact, TelegramContactRole } from "@/lib/telegram/types";
import { isTelegramRequestError } from "@/lib/telegram/types";

import { TelegramCard, TelegramGrid } from "./telegram-grid";
import { TelegramShell } from "./telegram-shell";

type TelegramContactsClientProps = {
  initialAuthStatus: TelegramAuthStatus | null;
  initialContacts: TelegramContact[];
  initialError: { status: number; code: string; message: string } | null;
};

type ContactFormState = {
  name: string;
  relation: string;
  phoneNumber: string;
  role: TelegramContactRole;
  priorityRank: string;
  notes: string;
  isActive: boolean;
};

const EMPTY_FORM: ContactFormState = {
  name: "",
  relation: "",
  phoneNumber: "",
  role: "contact",
  priorityRank: "",
  notes: "",
  isActive: true,
};

function sortContacts(contacts: TelegramContact[]) {
  return [...contacts].sort((left, right) => {
    if (left.priorityRank !== right.priorityRank) {
      return left.priorityRank - right.priorityRank;
    }

    return left.name.localeCompare(right.name);
  });
}

function toFormState(contact?: TelegramContact | null): ContactFormState {
  if (!contact) {
    return EMPTY_FORM;
  }

  return {
    name: contact.name,
    relation: contact.relation,
    phoneNumber: contact.phoneNumber,
    role: contact.role,
    priorityRank: String(contact.priorityRank),
    notes: contact.notes ?? "",
    isActive: contact.isActive,
  };
}

function validateRolePriority(formState: ContactFormState, contacts: TelegramContact[], editingContactId?: string | null) {
  if (!formState.name.trim() || !formState.relation.trim() || !formState.phoneNumber.trim()) {
    return "Name, relation, and phone number are required.";
  }

  const requestedRank = formState.priorityRank.trim() ? Number(formState.priorityRank) : undefined;
  if (requestedRank !== undefined && Number.isNaN(requestedRank)) {
    return "Priority rank must be numeric when provided.";
  }

  if (requestedRank !== undefined) {
    if (formState.role === "caretaker" && requestedRank !== 0) {
      return "Caretaker must use priority rank 0.";
    }

    if (formState.role === "emergency" && (requestedRank < 1 || requestedRank > 4)) {
      return "Emergency contacts must use priority rank 1 to 4.";
    }

    if (formState.role === "contact" && requestedRank < 100) {
      return "General contacts must use priority rank 100 or higher.";
    }
  }

  if (formState.isActive && formState.role === "caretaker") {
    const hasOtherCaretaker = contacts.some(
      (contact) => contact.id !== editingContactId && contact.isActive && contact.role === "caretaker",
    );

    if (hasOtherCaretaker) {
      return "Only one active caretaker is allowed.";
    }
  }

  if (formState.isActive && formState.role === "emergency") {
    const otherEmergencyCount = contacts.filter(
      (contact) => contact.id !== editingContactId && contact.isActive && contact.role === "emergency",
    ).length;

    if (otherEmergencyCount >= 4) {
      return "Only four active emergency contacts are allowed.";
    }
  }

  return null;
}

export function TelegramContactsClient({
  initialAuthStatus,
  initialContacts,
  initialError,
}: TelegramContactsClientProps) {
  const [authStatus, setAuthStatus] = useState(initialAuthStatus);
  const [contacts, setContacts] = useState(initialContacts);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [formState, setFormState] = useState<ContactFormState>(EMPTY_FORM);
  const [busyAction, setBusyAction] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState(initialError?.message ?? "");
  const [message, setMessage] = useState("");

  const connectionState = useTelegramEvents({
    ready: (nextStatus) => setAuthStatus(nextStatus),
    auth_state: (nextStatus) => setAuthStatus(nextStatus),
    contact_updated: (event) => {
      if (event.action === "deleted" && event.contactId) {
        setContacts((previous) => previous.filter((contact) => contact.id !== event.contactId));
        return;
      }

      if (!event.contact) {
        return;
      }

      setContacts((previous) => {
        const next = new Map(previous.map((contact) => [contact.id, contact]));
        next.set(event.contact!.id, event.contact!);
        return Array.from(next.values());
      });
    },
  });

  const appAuthRequired = !authStatus && initialError?.status === 401;
  const sortedContacts = useMemo(() => sortContacts(contacts), [contacts]);

  function resetForm() {
    setEditingContactId(null);
    setFormState(EMPTY_FORM);
  }

  async function handleSave() {
    const validationError = validateRolePriority(formState, contacts, editingContactId);
    if (validationError) {
      setError(validationError);
      setMessage("");
      return;
    }

    setBusyAction("save");
    setError("");
    setMessage("");

    const payload = {
      name: formState.name.trim(),
      relation: formState.relation.trim(),
      phoneNumber: formState.phoneNumber.trim(),
      role: formState.role,
      ...(formState.priorityRank.trim() ? { priorityRank: Number(formState.priorityRank) } : {}),
      ...(formState.notes.trim() ? { notes: formState.notes.trim() } : {}),
      isActive: formState.isActive,
    };

    try {
      const nextContact = editingContactId
        ? await telegramClient.updateContact(editingContactId, payload)
        : await telegramClient.createContact(payload);

      setContacts((previous) => {
        const next = new Map(previous.map((contact) => [contact.id, contact]));
        next.set(nextContact.id, nextContact);
        return Array.from(next.values());
      });
      setMessage(editingContactId ? "Contact updated." : "Contact created.");
      resetForm();
    } catch (requestError) {
      setError(isTelegramRequestError(requestError) ? requestError.message : "Contact could not be saved.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDelete(contactId: string) {
    setBusyAction("delete");
    setError("");
    setMessage("");

    try {
      await telegramClient.deleteContact(contactId);
      setContacts((previous) => previous.filter((contact) => contact.id !== contactId));
      if (editingContactId === contactId) {
        resetForm();
      }
      setMessage("Contact deleted.");
    } catch (requestError) {
      setError(isTelegramRequestError(requestError) ? requestError.message : "Contact could not be deleted.");
    } finally {
      setBusyAction(null);
    }
  }

  if (appAuthRequired) {
    return (
      <TelegramShell
        title="Telegram Contacts"
        subtitle="The backend protects contact management behind the signed-in app session."
        connectionState={connectionState}
      >
        <TelegramGrid>
          <TelegramCard label="Back" subtitle="Return to messaging." icon={<ArrowLeft className="size-5" />} href="/messaging" />
          <TelegramCard label="Sign In" subtitle="Open the main auth screen first." icon={<UserRoundCog className="size-5" />} href="/auth" />
          <TelegramCard label="Setup" subtitle="Return to setup if patient data is missing." icon={<Plus className="size-5" />} href="/setup" />
          <TelegramCard label="Chat Grid" subtitle="The chat grid unlocks after sign-in." icon={<MessageSquareMore className="size-5" />} href="/messaging/chats" disabled />
          <TelegramCard label="Connect" subtitle="Telegram auth becomes available after sign-in." icon={<Save className="size-5" />} href="/messaging/connect" disabled />
          <TelegramCard label="Error" subtitle={initialError.message} icon={<Trash2 className="size-5" />} tone="danger" />
        </TelegramGrid>
      </TelegramShell>
    );
  }

  return (
    <TelegramShell
      title="Approved Contacts"
      subtitle="Create and maintain the exact contact list that Telegram is allowed to open chats for. Priority rank and role rules mirror the backend validation."
      connectionState={connectionState}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link
          href="/messaging"
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
        >
          <ArrowLeft className="size-4" />
          Back
        </Link>
        <Link
          href="/messaging/chats"
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
        >
          <MessageSquareMore className="size-4" />
          Chats
        </Link>
      </div>

      <div className="grid h-[calc(100%-3.25rem)] min-h-0 gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="min-h-0 overflow-y-auto rounded-[28px] border border-zinc-700/70 bg-zinc-950/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">
                {editingContactId ? "Edit Contact" : "Create Contact"}
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                {editingContactId ? "Update approved person" : "Add approved person"}
              </h2>
            </div>

            {editingContactId ? (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex rounded-2xl border border-white/10 bg-white/4 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:bg-white/8"
              >
                Cancel
              </button>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-zinc-300">Name</span>
              <input
                value={formState.name}
                onChange={(event) => setFormState((previous) => ({ ...previous, name: event.target.value }))}
                className="h-10 w-full rounded-2xl border border-white/10 bg-white/4 px-4 text-sm text-white outline-none transition focus:border-cyan-400/60 focus:bg-white/[0.07]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-zinc-300">Relation</span>
              <input
                value={formState.relation}
                onChange={(event) => setFormState((previous) => ({ ...previous, relation: event.target.value }))}
                className="h-10 w-full rounded-2xl border border-white/10 bg-white/4 px-4 text-sm text-white outline-none transition focus:border-cyan-400/60 focus:bg-white/[0.07]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-zinc-300">Phone Number</span>
              <input
                value={formState.phoneNumber}
                onChange={(event) => setFormState((previous) => ({ ...previous, phoneNumber: event.target.value }))}
                className="h-10 w-full rounded-2xl border border-white/10 bg-white/4 px-4 text-sm text-white outline-none transition focus:border-cyan-400/60 focus:bg-white/[0.07]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-zinc-300">Role</span>
              <select
                value={formState.role}
                onChange={(event) =>
                  setFormState((previous) => ({ ...previous, role: event.target.value as TelegramContactRole }))
                }
                className="h-10 w-full rounded-2xl border border-white/10 bg-white/4 px-4 text-sm text-white outline-none transition focus:border-cyan-400/60 focus:bg-white/[0.07]"
              >
                <option value="caretaker">Caretaker</option>
                <option value="emergency">Emergency</option>
                <option value="contact">Contact</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-zinc-300">Priority Rank</span>
              <input
                value={formState.priorityRank}
                onChange={(event) => setFormState((previous) => ({ ...previous, priorityRank: event.target.value }))}
                placeholder={formState.role === "caretaker" ? "0" : formState.role === "emergency" ? "1-4" : "100+"}
                className="h-10 w-full rounded-2xl border border-white/10 bg-white/4 px-4 text-sm text-white outline-none transition focus:border-cyan-400/60 focus:bg-white/[0.07]"
              />
            </label>

            <label className="flex h-10 items-center gap-3 rounded-2xl border border-white/10 bg-white/4 px-4 text-sm text-zinc-200">
              <input
                type="checkbox"
                checked={formState.isActive}
                onChange={(event) => setFormState((previous) => ({ ...previous, isActive: event.target.checked }))}
                className="size-4 rounded border-white/20 bg-transparent"
              />
              Active contact
            </label>
          </div>

          <label className="mt-3 block">
            <span className="mb-2 block text-sm font-medium text-zinc-300">Notes</span>
            <textarea
              value={formState.notes}
              onChange={(event) => setFormState((previous) => ({ ...previous, notes: event.target.value }))}
              rows={2}
              className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/60 focus:bg-white/[0.07]"
            />
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={busyAction !== null}
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:opacity-50"
            >
              {busyAction === "save" ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editingContactId ? "Save Changes" : "Create Contact"}
            </button>
            <span className="text-sm text-zinc-500">
              Caretaker rank must be 0, emergency must be 1-4, and general contacts should start at 100.
            </span>
          </div>

          {message ? (
            <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 overflow-y-auto rounded-[28px] border border-zinc-700/70 bg-zinc-950/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Saved Contacts</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">{sortedContacts.length} total contacts</h2>
            </div>
            <span className="rounded-full border border-white/10 bg-white/4 px-4 py-2 text-sm font-medium text-zinc-300">
              Auth: {authStatus?.authState.replaceAll("_", " ") ?? "unknown"}
            </span>
          </div>

          <div className="mt-6 space-y-3">
            {sortedContacts.map((contact) => (
              <div
                key={contact.id}
                className="rounded-[24px] border border-white/10 bg-white/4 p-4 transition hover:bg-white/6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-zinc-100">{contact.name}</p>
                    <p className="mt-1 text-sm text-zinc-400">
                      {contact.relation} · {contact.role} · rank {contact.priorityRank}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {contact.phoneNumber}
                      {contact.telegramChatId ? ` · Chat ${contact.telegramChatId}` : " · Telegram chat unresolved"}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingContactId(contact.id);
                        setFormState(toFormState(contact));
                        setError("");
                        setMessage("");
                      }}
                      className="inline-flex h-10 items-center rounded-2xl border border-white/10 bg-white/4 px-4 text-sm font-semibold text-zinc-100 transition hover:bg-white/8"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(contact.id)}
                      disabled={busyAction !== null}
                      className="inline-flex h-10 items-center rounded-2xl border border-red-500/20 bg-red-500/10 px-4 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
                  <span className={`rounded-full px-2.5 py-1 ${contact.isActive ? "bg-emerald-500/10 text-emerald-200" : "bg-zinc-800 text-zinc-400"}`}>
                    {contact.isActive ? "active" : "inactive"}
                  </span>
                  {contact.lastResolvedAt ? <span>resolved {new Date(contact.lastResolvedAt).toLocaleString()}</span> : null}
                </div>
              </div>
            ))}

            {!sortedContacts.length ? (
              <div className="rounded-[24px] border border-dashed border-white/12 bg-white/2 p-6 text-sm text-zinc-500">
                No approved Telegram contacts yet. Create one on the left to unlock the chat grid.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </TelegramShell>
  );
}
