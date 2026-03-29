import { t } from "elysia";

const nullableString = t.Union([t.String(), t.Null()]);

export const necessitySchemas = {
  error: t.Object({
    error: t.String(),
    message: t.String(),
  }),
  necessity: t.Object({
    id: t.String(),
    patientId: t.String(),
    label: t.String(),
    internalMessage: t.String(),
    svgMarkup: t.String(),
    isActive: t.Boolean(),
    sortOrder: t.Integer(),
    createdAt: t.String({ format: "date-time" }),
    updatedAt: t.String({ format: "date-time" }),
  }),
  createBody: t.Object({
    label: t.String({ minLength: 1 }),
    internalMessage: t.String({ minLength: 1 }),
    svgMarkup: t.String({ minLength: 1 }),
    isActive: t.Optional(t.Boolean()),
    sortOrder: t.Optional(t.Integer()),
  }),
  updateBody: t.Object({
    label: t.Optional(t.String({ minLength: 1 })),
    internalMessage: t.Optional(t.String({ minLength: 1 })),
    svgMarkup: t.Optional(t.String({ minLength: 1 })),
    isActive: t.Optional(t.Boolean()),
    sortOrder: t.Optional(t.Integer()),
  }),
  requestStatus: t.Union([
    t.Literal("pending"),
    t.Literal("acknowledged"),
    t.Literal("escalated"),
  ]),
  request: t.Object({
    id: t.String(),
    patientId: t.String(),
    necessityId: t.String(),
    caretakerContactId: t.String(),
    telegramChatId: t.String(),
    labelSnapshot: t.String(),
    messageSnapshot: t.String(),
    status: t.Union([
      t.Literal("pending"),
      t.Literal("acknowledged"),
      t.Literal("escalated"),
    ]),
    telegramMessageId: nullableString,
    triggeredAt: t.String({ format: "date-time" }),
    acknowledgedAt: nullableString,
    escalatedAt: nullableString,
    escalateAfterSeconds: t.Integer(),
    createdAt: t.String({ format: "date-time" }),
    updatedAt: t.String({ format: "date-time" }),
  }),
  triggerResponse: t.Object({
    id: t.String(),
    necessityId: t.String(),
    status: t.Union([
      t.Literal("pending"),
      t.Literal("acknowledged"),
      t.Literal("escalated"),
    ]),
    triggeredAt: t.String({ format: "date-time" }),
    escalateAfterSeconds: t.Integer(),
  }),
} as const;
