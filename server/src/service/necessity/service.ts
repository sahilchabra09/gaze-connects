import { and, asc, desc, eq, max } from "drizzle-orm";
import { db } from "@/db";
import { necessityRequest, patientContact, patientNecessity } from "@/db/schema";
import { logger, serializeError } from "@/lib/logger";
import { telegramSseBroker } from "@/service/telegram-message/sse-broker";
import { NecessityDomainError } from "./errors";
import type {
  NecessityCreateInput,
  NecessityRecord,
  NecessityRequestEventPayload,
  NecessityRequestRecord,
  NecessityTriggerResponse,
  NecessityUpdateInput,
} from "./types";

const DEFAULT_ESCALATION_SECONDS = 45;

type PendingTimer = ReturnType<typeof setTimeout>;

type TriggerDependencies = {
  sendTelegramMessage: (chatId: string, text: string) => Promise<{ id: string; chatId?: string }>
};

function toNecessityRecord(row: typeof patientNecessity.$inferSelect): NecessityRecord {
  return {
    id: row.id,
    patientId: row.patientId,
    label: row.label,
    internalMessage: row.internalMessage,
    svgMarkup: row.svgMarkup,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toNecessityRequestRecord(row: typeof necessityRequest.$inferSelect): NecessityRequestRecord {
  return {
    id: row.id,
    patientId: row.patientId,
    necessityId: row.necessityId,
    caretakerContactId: row.caretakerContactId,
    telegramChatId: row.telegramChatId,
    labelSnapshot: row.labelSnapshot,
    messageSnapshot: row.messageSnapshot,
    status: row.status,
    telegramMessageId: row.telegramMessageId,
    triggeredAt: row.triggeredAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    escalatedAt: row.escalatedAt?.toISOString() ?? null,
    escalateAfterSeconds: row.escalateAfterSeconds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function trimOrNull(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertSvgMarkup(value: string): void {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().includes("<svg")) {
    throw new NecessityDomainError("INVALID_SVG_MARKUP", 400, "SVG markup must include an <svg> element");
  }
}

export class NecessityService {
  private readonly pendingTimers = new Map<string, PendingTimer>();
  private initialization: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.initialization) {
      return this.initialization;
    }

    this.initialization = this.restorePendingRequests().catch((error) => {
      this.initialization = null;
      throw error;
    });

    return this.initialization;
  }

  async list(patientId: string): Promise<NecessityRecord[]> {
    const rows = await db
      .select()
      .from(patientNecessity)
      .where(eq(patientNecessity.patientId, patientId))
      .orderBy(asc(patientNecessity.sortOrder), asc(patientNecessity.createdAt));

    return rows.map(toNecessityRecord);
  }

  async listActive(patientId: string): Promise<NecessityRecord[]> {
    const rows = await db
      .select()
      .from(patientNecessity)
      .where(and(eq(patientNecessity.patientId, patientId), eq(patientNecessity.isActive, true)))
      .orderBy(asc(patientNecessity.sortOrder), asc(patientNecessity.createdAt));

    return rows.map(toNecessityRecord);
  }

  async create(patientId: string, input: NecessityCreateInput): Promise<NecessityRecord> {
    const label = trimOrNull(input.label);
    const internalMessage = trimOrNull(input.internalMessage);
    const svgMarkup = trimOrNull(input.svgMarkup);

    if (!label || !internalMessage || !svgMarkup) {
      throw new NecessityDomainError("VALIDATION_ERROR", 400, "Label, internal message, and SVG markup are required");
    }

    assertSvgMarkup(svgMarkup);

    const sortOrder =
      input.sortOrder ??
      ((await db
        .select({ maxSortOrder: max(patientNecessity.sortOrder) })
        .from(patientNecessity)
        .where(eq(patientNecessity.patientId, patientId)))[0]?.maxSortOrder ?? -1) + 1;

    const inserted = await db
      .insert(patientNecessity)
      .values({
        id: crypto.randomUUID(),
        patientId,
        label,
        internalMessage,
        svgMarkup,
        isActive: input.isActive ?? true,
        sortOrder,
      })
      .returning();

    return toNecessityRecord(inserted[0]!);
  }

  async update(patientId: string, necessityId: string, input: NecessityUpdateInput): Promise<NecessityRecord> {
    const existing = await db
      .select()
      .from(patientNecessity)
      .where(and(eq(patientNecessity.patientId, patientId), eq(patientNecessity.id, necessityId)))
      .limit(1);

    const current = existing[0];
    if (!current) {
      throw new NecessityDomainError("NECESSITY_NOT_FOUND", 404, "Necessity not found");
    }

    const nextLabel = trimOrNull(input.label) ?? current.label;
    const nextMessage = trimOrNull(input.internalMessage) ?? current.internalMessage;
    const nextSvgMarkup = trimOrNull(input.svgMarkup) ?? current.svgMarkup;
    assertSvgMarkup(nextSvgMarkup);

    const updated = await db
      .update(patientNecessity)
      .set({
        label: nextLabel,
        internalMessage: nextMessage,
        svgMarkup: nextSvgMarkup,
        isActive: input.isActive ?? current.isActive,
        sortOrder: input.sortOrder ?? current.sortOrder,
        updatedAt: new Date(),
      })
      .where(and(eq(patientNecessity.patientId, patientId), eq(patientNecessity.id, necessityId)))
      .returning();

    return toNecessityRecord(updated[0]!);
  }

  async trigger(
    patientId: string,
    necessityId: string,
    dependencies: TriggerDependencies,
  ): Promise<NecessityTriggerResponse> {
    await this.initialize();

    const necessity = await this.requireActiveNecessity(patientId, necessityId);
    const caretaker = await this.requireActiveCaretaker(patientId);

    if (!caretaker.telegramChatId) {
      throw new NecessityDomainError(
        "CARETAKER_CHAT_NOT_MAPPED",
        409,
        "Active caretaker must have a resolved Telegram chat before necessities can be sent",
      );
    }

    const sentMessage = await dependencies.sendTelegramMessage(caretaker.telegramChatId, necessity.internalMessage);
    const resolvedChatId = sentMessage.chatId ?? caretaker.telegramChatId;
    const triggeredAt = new Date();

    const inserted = await db
      .insert(necessityRequest)
      .values({
        id: crypto.randomUUID(),
        patientId,
        necessityId: necessity.id,
        caretakerContactId: caretaker.id,
        telegramChatId: resolvedChatId,
        labelSnapshot: necessity.label,
        messageSnapshot: necessity.internalMessage,
        status: "pending",
        telegramMessageId: sentMessage.id,
        triggeredAt,
        escalateAfterSeconds: DEFAULT_ESCALATION_SECONDS,
      })
      .returning();

    const requestRecord = toNecessityRequestRecord(inserted[0]!);
    this.schedulePendingRequest(requestRecord);
    telegramSseBroker.publish(patientId, "necessity_request_created", {
      request: requestRecord,
    } satisfies NecessityRequestEventPayload);

    return {
      id: requestRecord.id,
      necessityId: requestRecord.necessityId,
      status: requestRecord.status,
      triggeredAt: requestRecord.triggeredAt,
      escalateAfterSeconds: requestRecord.escalateAfterSeconds,
    };
  }

  async acknowledgeMostRecentPendingByChat(patientId: string, chatId: string): Promise<NecessityRequestRecord | null> {
    await this.initialize();

    const pending = await db
      .select()
      .from(necessityRequest)
      .where(
        and(
          eq(necessityRequest.patientId, patientId),
          eq(necessityRequest.telegramChatId, chatId),
          eq(necessityRequest.status, "pending"),
        ),
      )
      .orderBy(desc(necessityRequest.triggeredAt), desc(necessityRequest.createdAt))
      .limit(1);

    const current = pending[0];
    if (!current) {
      return null;
    }

    this.clearPendingTimer(current.id);

    const acknowledged = await db
      .update(necessityRequest)
      .set({
        status: "acknowledged",
        acknowledgedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(necessityRequest.id, current.id), eq(necessityRequest.status, "pending")))
      .returning();

    const row = acknowledged[0];
    if (!row) {
      return null;
    }

    const record = toNecessityRequestRecord(row);
    telegramSseBroker.publish(patientId, "necessity_request_acknowledged", {
      request: record,
    } satisfies NecessityRequestEventPayload);

    await db.delete(necessityRequest).where(eq(necessityRequest.id, row.id));
    return record;
  }

  private async restorePendingRequests(): Promise<void> {
    const rows = await db
      .select()
      .from(necessityRequest)
      .where(eq(necessityRequest.status, "pending"))
      .orderBy(asc(necessityRequest.triggeredAt));

    for (const row of rows) {
      this.schedulePendingRequest(toNecessityRequestRecord(row));
    }
  }

  private schedulePendingRequest(request: NecessityRequestRecord): void {
    this.clearPendingTimer(request.id);

    const dueAt =
      new Date(request.triggeredAt).getTime() + request.escalateAfterSeconds * 1000;
    const delay = Math.max(0, dueAt - Date.now());

    const timer = setTimeout(() => {
      void this.escalateRequest(request.id);
    }, delay);

    this.pendingTimers.set(request.id, timer);
  }

  private clearPendingTimer(requestId: string): void {
    const timer = this.pendingTimers.get(requestId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.pendingTimers.delete(requestId);
  }

  private async escalateRequest(requestId: string): Promise<void> {
    this.clearPendingTimer(requestId);

    const updated = await db
      .update(necessityRequest)
      .set({
        status: "escalated",
        escalatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(necessityRequest.id, requestId), eq(necessityRequest.status, "pending")))
      .returning();

    const row = updated[0];
    if (!row) {
      return;
    }

    const record = toNecessityRequestRecord(row);

    try {
      await this.triggerDummyCaretakerCall(record);
    } catch (error) {
      logger.error(
        { requestId, patientId: record.patientId, error: serializeError(error) },
        "dummy caretaker call failed after necessity escalation",
      );
    }

    telegramSseBroker.publish(record.patientId, "necessity_request_escalated", {
      request: record,
    } satisfies NecessityRequestEventPayload);
  }

  private async triggerDummyCaretakerCall(request: NecessityRequestRecord): Promise<void> {
    logger.info(
      {
        requestId: request.id,
        patientId: request.patientId,
        caretakerContactId: request.caretakerContactId,
        labelSnapshot: request.labelSnapshot,
      },
      "dummy caretaker call triggered for escalated necessity request",
    );
  }

  private async requireActiveNecessity(patientId: string, necessityId: string): Promise<NecessityRecord> {
    const rows = await db
      .select()
      .from(patientNecessity)
      .where(
        and(
          eq(patientNecessity.patientId, patientId),
          eq(patientNecessity.id, necessityId),
          eq(patientNecessity.isActive, true),
        ),
      )
      .limit(1);

    const necessity = rows[0];
    if (!necessity) {
      throw new NecessityDomainError("NECESSITY_NOT_FOUND", 404, "Active necessity not found");
    }

    return toNecessityRecord(necessity);
  }

  private async requireActiveCaretaker(patientId: string) {
    const rows = await db
      .select()
      .from(patientContact)
      .where(
        and(
          eq(patientContact.patientId, patientId),
          eq(patientContact.role, "caretaker"),
          eq(patientContact.isActive, true),
        ),
      )
      .orderBy(asc(patientContact.priorityRank), asc(patientContact.createdAt))
      .limit(1);

    const caretaker = rows[0];
    if (!caretaker) {
      throw new NecessityDomainError(
        "CARETAKER_NOT_CONFIGURED",
        409,
        "An active caretaker contact is required before necessities can be sent",
      );
    }

    return caretaker;
  }
}

export const necessityService = new NecessityService();
