import { patientContact } from "@/db/schema";
import type { ContactRole } from "./common";

export type ContactRow = typeof patientContact.$inferSelect;

export type ContactInput = {
  name: string
  relation: string
  phoneNumber: string
  role: ContactRole
  priorityRank?: number
  notes?: string | null
  isActive?: boolean
};

export type ContactUpdateInput = Partial<ContactInput>;

export type PatientContactRecord = {
  id: string
  patientId: string
  role: ContactRole
  priorityRank: number
  name: string
  relation: string
  phoneNumber: string
  phoneNumberNormalized: string
  telegramUserId: string | null
  telegramChatId: string | null
  isActive: boolean
  notes: string | null
  lastResolvedAt: string | null
  createdAt: string
  updatedAt: string
};