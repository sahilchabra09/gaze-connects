import { NECESSITY_REQUEST_STATUSES } from "@/db/schema";

export type NecessityRequestStatus = (typeof NECESSITY_REQUEST_STATUSES)[number];

export type NecessityRecord = {
  id: string
  patientId: string
  label: string
  internalMessage: string
  svgMarkup: string
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
};

export type NecessityRequestRecord = {
  id: string
  patientId: string
  necessityId: string
  caretakerContactId: string
  telegramChatId: string
  labelSnapshot: string
  messageSnapshot: string
  status: NecessityRequestStatus
  telegramMessageId: string | null
  triggeredAt: string
  acknowledgedAt: string | null
  escalatedAt: string | null
  escalateAfterSeconds: number
  createdAt: string
  updatedAt: string
};

export type NecessityCreateInput = {
  label: string
  internalMessage: string
  svgMarkup: string
  isActive?: boolean
  sortOrder?: number
};

export type NecessityUpdateInput = Partial<NecessityCreateInput>;

export type NecessityTriggerResponse = {
  id: string
  necessityId: string
  status: NecessityRequestStatus
  triggeredAt: string
  escalateAfterSeconds: number
};

export type NecessityRequestEventPayload = {
  request: NecessityRequestRecord
};
