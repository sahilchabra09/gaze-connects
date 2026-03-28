import type { TelegramEventPayload } from "./event";

export type Subscriber = (event: TelegramEventPayload) => void;