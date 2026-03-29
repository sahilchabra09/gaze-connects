export const NECESSITY_REQUEST_STATUSES = ["pending", "acknowledged", "escalated"] as const;

export type NecessityRequestStatus = (typeof NECESSITY_REQUEST_STATUSES)[number];

export type Necessity = {
  id: string;
  patientId: string;
  label: string;
  internalMessage: string;
  svgMarkup: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type NecessityInput = {
  label: string;
  internalMessage: string;
  svgMarkup: string;
  isActive?: boolean;
  sortOrder?: number;
};

export type NecessityRequest = {
  id: string;
  patientId: string;
  necessityId: string;
  caretakerContactId: string;
  telegramChatId: string;
  labelSnapshot: string;
  messageSnapshot: string;
  status: NecessityRequestStatus;
  telegramMessageId: string | null;
  triggeredAt: string;
  acknowledgedAt: string | null;
  escalatedAt: string | null;
  escalateAfterSeconds: number;
  createdAt: string;
  updatedAt: string;
};

export type NecessityTriggerResponse = {
  id: string;
  necessityId: string;
  status: NecessityRequestStatus;
  triggeredAt: string;
  escalateAfterSeconds: number;
};

export type NecessityRequestEventData = {
  request: NecessityRequest;
};

export type NecessityApiErrorPayload = {
  error: string;
  message: string;
};

export class NecessityRequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "NecessityRequestError";
    this.status = status;
    this.code = code;
  }
}

export function isNecessityRequestError(error: unknown): error is NecessityRequestError {
  return error instanceof NecessityRequestError;
}
