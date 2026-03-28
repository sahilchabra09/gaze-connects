import type * as tdl from "tdl";
import type { TelegramAuthState } from "./common";

export type TdlibClient = ReturnType<typeof tdl.createClient>;

export type TdObject = { _: string; [key: string]: any };

export type PatientRuntime = {
  patientId: string
  sessionPath: string
  client: TdlibClient
  authState: TelegramAuthState
  telegramUserId: string | null
  connectedAt: string | null
};

export type EnsureRuntimeOptions = {
  skipInitialize?: boolean
};

export type TdMessage = TdObject & {
  id: string | number
  chat_id: string | number
  content?: TdObject
  is_outgoing: boolean
  date: number
};

export type TdChat = TdObject & {
  id: string | number
  title: string
  last_message?: TdMessage
  unread_count: number
};