import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const patientTelegramSession = pgTable("patient_telegram_session", {
  patientId: text("patient_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  telegramUserId: text("telegram_user_id"),
  sessionPath: text("session_path").notNull(),
  authState: text("auth_state").notNull(),
  connectedAt: timestamp("connected_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const patientContact = pgTable(
  "patient_contact",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    priorityRank: integer("priority_rank").notNull(),
    name: text("name").notNull(),
    relation: text("relation").notNull(),
    phoneNumber: text("phone_number").notNull(),
    phoneNumberNormalized: text("phone_number_normalized").notNull(),
    telegramUserId: text("telegram_user_id"),
    telegramChatId: text("telegram_chat_id"),
    isActive: boolean("is_active").default(true).notNull(),
    notes: text("notes"),
    lastResolvedAt: timestamp("last_resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("patient_contact_patient_phone_unique").on(table.patientId, table.phoneNumberNormalized),
    index("patient_contact_patient_role_rank_idx").on(table.patientId, table.role, table.priorityRank),
    index("patient_contact_patient_telegram_user_idx").on(table.patientId, table.telegramUserId),
    index("patient_contact_patient_telegram_chat_idx").on(table.patientId, table.telegramChatId),
  ],
);

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  patientContacts: many(patientContact),
  patientTelegramSession: one(patientTelegramSession, {
    fields: [user.id],
    references: [patientTelegramSession.patientId],
  }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const patientTelegramSessionRelations = relations(patientTelegramSession, ({ one }) => ({
  patient: one(user, {
    fields: [patientTelegramSession.patientId],
    references: [user.id],
  }),
}));

export const patientContactRelations = relations(patientContact, ({ one }) => ({
  patient: one(user, {
    fields: [patientContact.patientId],
    references: [user.id],
  }),
}));
