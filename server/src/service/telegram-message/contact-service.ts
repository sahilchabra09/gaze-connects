import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { patientContact } from "@/db/schema";
import { logger } from "@/lib/logger";
import { TelegramDomainError } from "./errors";
import { normalizePhoneNumber } from "./phone";
import type { ContactInput, ContactRole, ContactRow, ContactUpdateInput, PatientContactRecord } from "./types";

function toRecord(row: ContactRow): PatientContactRecord {
  return {
    id: row.id,
    patientId: row.patientId,
    role: row.role as ContactRole,
    priorityRank: row.priorityRank,
    name: row.name,
    relation: row.relation,
    phoneNumber: row.phoneNumber,
    phoneNumberNormalized: row.phoneNumberNormalized,
    telegramUserId: row.telegramUserId,
    telegramChatId: row.telegramChatId,
    isActive: row.isActive,
    notes: row.notes,
    lastResolvedAt: row.lastResolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertRoleRank(role: ContactRole, rank: number): void {
  if (role === "caretaker" && rank !== 0) {
    throw new TelegramDomainError("INVALID_PRIORITY_RANK", 400, "Caretaker must use priority rank 0");
  }

  if (role === "emergency" && (rank < 1 || rank > 4)) {
    throw new TelegramDomainError("INVALID_PRIORITY_RANK", 400, "Emergency contacts must use priority ranks 1 to 4");
  }

  if (role === "contact" && rank < 100) {
    throw new TelegramDomainError("INVALID_PRIORITY_RANK", 400, "General contacts must use priority rank 100 or higher");
  }
}

function sanitizeText(value: string): string {
  return value.trim();
}

function buildActiveContacts(contacts: ContactRow[], excludeId?: string): ContactRow[] {
  return contacts.filter((contact) => contact.id !== excludeId && contact.isActive);
}

export class ContactService {
  async list(patientId: string): Promise<PatientContactRecord[]> {
    const contacts = await db
      .select()
      .from(patientContact)
      .where(eq(patientContact.patientId, patientId))
      .orderBy(asc(patientContact.priorityRank), asc(patientContact.createdAt));

    return contacts.map(toRecord);
  }

  async listActiveMapped(patientId: string): Promise<PatientContactRecord[]> {
    const contacts = await db
      .select()
      .from(patientContact)
      .where(
        and(
          eq(patientContact.patientId, patientId),
          eq(patientContact.isActive, true),
        ),
      )
      .orderBy(asc(patientContact.priorityRank), asc(patientContact.createdAt));

    return contacts.filter((contact) => contact.telegramChatId !== null).map(toRecord);
  }

  async getById(patientId: string, contactId: string): Promise<PatientContactRecord> {
    const existing = await db
      .select()
      .from(patientContact)
      .where(and(eq(patientContact.patientId, patientId), eq(patientContact.id, contactId)));

    const contact = existing[0];
    if (!contact) {
      throw new TelegramDomainError("CONTACT_NOT_FOUND", 404, "Contact not found");
    }

    return toRecord(contact);
  }

  async getActiveById(patientId: string, contactId: string): Promise<PatientContactRecord> {
    const contact = await this.getById(patientId, contactId);
    if (!contact.isActive) {
      throw new TelegramDomainError("CONTACT_INACTIVE", 409, "Contact is inactive");
    }

    return contact;
  }

  async getActiveByChatId(patientId: string, chatId: string): Promise<PatientContactRecord> {
    const existing = await db
      .select()
      .from(patientContact)
      .where(
        and(
          eq(patientContact.patientId, patientId),
          eq(patientContact.telegramChatId, chatId),
          eq(patientContact.isActive, true),
        ),
      );

    const contact = existing[0];
    if (!contact) {
      throw new TelegramDomainError("CHAT_NOT_ALLOWED", 404, "Chat is not allowed for this patient");
    }

    return toRecord(contact);
  }

  async getActiveByTelegramUserId(patientId: string, telegramUserId: string): Promise<PatientContactRecord | null> {
    const existing = await db
      .select()
      .from(patientContact)
      .where(
        and(
          eq(patientContact.patientId, patientId),
          eq(patientContact.telegramUserId, telegramUserId),
          eq(patientContact.isActive, true),
        ),
      );

    return existing[0] ? toRecord(existing[0]) : null;
  }

  async create(patientId: string, input: ContactInput): Promise<PatientContactRecord> {
    return db.transaction(async (tx) => {
      const phoneNumber = sanitizeText(input.phoneNumber);
      const phoneNumberNormalized = normalizePhoneNumber(phoneNumber);
      const existingContacts = await tx
        .select()
        .from(patientContact)
        .where(eq(patientContact.patientId, patientId));

      this.assertPhoneUnique(existingContacts, phoneNumberNormalized);

      const role = input.role;
      const isActive = input.isActive ?? true;
      const priorityRank = this.resolvePriorityRank(existingContacts, {
        role,
        requestedRank: input.priorityRank,
        isActive,
      });

      const inserted = await tx
        .insert(patientContact)
        .values({
          id: crypto.randomUUID(),
          patientId,
          role,
          priorityRank,
          name: sanitizeText(input.name),
          relation: sanitizeText(input.relation),
          phoneNumber,
          phoneNumberNormalized,
          isActive,
          notes: input.notes?.trim() || null,
        })
        .returning();

      return toRecord(inserted[0]!);
    });
  }

  async update(patientId: string, contactId: string, input: ContactUpdateInput): Promise<PatientContactRecord> {
    return db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(patientContact)
        .where(and(eq(patientContact.patientId, patientId), eq(patientContact.id, contactId)));

      const current = existing[0];
      if (!current) {
        throw new TelegramDomainError("CONTACT_NOT_FOUND", 404, "Contact not found");
      }

      const allContacts = await tx
        .select()
        .from(patientContact)
        .where(eq(patientContact.patientId, patientId));

      const role = (input.role ?? current.role) as ContactRole;
      const phoneNumber = sanitizeText(input.phoneNumber ?? current.phoneNumber);
      const phoneNumberNormalized = normalizePhoneNumber(phoneNumber);
      this.assertPhoneUnique(allContacts, phoneNumberNormalized, contactId);

      const isActive = input.isActive ?? current.isActive;
      const priorityRank = this.resolvePriorityRank(allContacts, {
        role,
        requestedRank: input.priorityRank ?? current.priorityRank,
        isActive,
        excludeId: contactId,
      });

      const phoneChanged = phoneNumberNormalized !== current.phoneNumberNormalized;

      const updated = await tx
        .update(patientContact)
        .set({
          role,
          priorityRank,
          name: input.name ? sanitizeText(input.name) : current.name,
          relation: input.relation ? sanitizeText(input.relation) : current.relation,
          phoneNumber,
          phoneNumberNormalized,
          isActive,
          notes: input.notes !== undefined ? input.notes?.trim() || null : current.notes,
          telegramUserId: phoneChanged ? null : current.telegramUserId,
          telegramChatId: phoneChanged ? null : current.telegramChatId,
          lastResolvedAt: phoneChanged ? null : current.lastResolvedAt,
          updatedAt: new Date(),
        })
        .where(and(eq(patientContact.patientId, patientId), eq(patientContact.id, contactId)))
        .returning();

      return toRecord(updated[0]!);
    });
  }

  async delete(patientId: string, contactId: string): Promise<void> {
    const deleted = await db
      .delete(patientContact)
      .where(and(eq(patientContact.patientId, patientId), eq(patientContact.id, contactId)))
      .returning({ id: patientContact.id });

    if (!deleted[0]) {
      throw new TelegramDomainError("CONTACT_NOT_FOUND", 404, "Contact not found");
    }
  }

  async linkTelegramIdentity(
    patientId: string,
    contactId: string,
    identities: { telegramUserId: string; telegramChatId: string },
  ): Promise<PatientContactRecord> {
    const updated = await db
      .update(patientContact)
      .set({
        telegramUserId: identities.telegramUserId,
        telegramChatId: identities.telegramChatId,
        lastResolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(patientContact.patientId, patientId), eq(patientContact.id, contactId)))
      .returning();

    const contact = updated[0];
    if (!contact) {
      throw new TelegramDomainError("CONTACT_NOT_FOUND", 404, "Contact not found");
    }

    logger.info(
      {
        patientId,
        contactId,
        chatId: identities.telegramChatId,
        telegramUserId: identities.telegramUserId,
      },
      "linked contact to telegram identity",
    );

    return toRecord(contact);
  }

  private assertPhoneUnique(contacts: ContactRow[], phoneNumberNormalized: string, excludeId?: string): void {
    const existing = contacts.find(
      (contact) =>
        contact.id !== excludeId && contact.phoneNumberNormalized === phoneNumberNormalized,
    );

    if (existing) {
      throw new TelegramDomainError("CONTACT_PHONE_EXISTS", 409, "Phone number is already saved for this patient");
    }
  }

  private resolvePriorityRank(
    contacts: ContactRow[],
    options: {
      role: ContactRole
      requestedRank?: number
      isActive: boolean
      excludeId?: string
    },
  ): number {
    const activeContacts = buildActiveContacts(contacts, options.excludeId);

    if (options.requestedRank !== undefined) {
      assertRoleRank(options.role, options.requestedRank);
      this.assertActiveRoleAvailability(activeContacts, options.role, options.requestedRank, options.isActive);
      return options.requestedRank;
    }

    if (options.role === "caretaker") {
      this.assertActiveRoleAvailability(activeContacts, options.role, 0, options.isActive);
      return 0;
    }

    if (options.role === "emergency") {
      const used = new Set(
        activeContacts
          .filter((contact) => contact.role === "emergency")
          .map((contact) => contact.priorityRank),
      );

      for (let rank = 1; rank <= 4; rank += 1) {
        if (!used.has(rank)) {
          return rank;
        }
      }

      throw new TelegramDomainError("EMERGENCY_CONTACT_LIMIT", 409, "Only four active emergency contacts are allowed");
    }

    const usedContactRanks = activeContacts
      .filter((contact) => contact.role === "contact" && contact.priorityRank >= 100)
      .map((contact) => contact.priorityRank);

    return Math.max(99, ...usedContactRanks) + 1;
  }

  private assertActiveRoleAvailability(
    activeContacts: ContactRow[],
    role: ContactRole,
    priorityRank: number,
    isActive: boolean,
  ): void {
    if (!isActive) {
      return;
    }

    if (role === "caretaker" && activeContacts.some((contact) => contact.role === "caretaker")) {
      throw new TelegramDomainError("CARETAKER_EXISTS", 409, "Only one active caretaker is allowed");
    }

    if (activeContacts.some((contact) => contact.priorityRank === priorityRank)) {
      throw new TelegramDomainError("PRIORITY_RANK_EXISTS", 409, "Priority rank is already used by another active contact");
    }
  }
}

export const contactService = new ContactService();
