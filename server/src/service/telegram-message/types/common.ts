export const TELEGRAM_AUTH_STATES = [
  "waiting_phone_number",
  "waiting_code",
  "waiting_password",
  "authenticated",
  "expired",
] as const;

export type TelegramAuthState = (typeof TELEGRAM_AUTH_STATES)[number];

export const CONTACT_ROLES = ["caretaker", "emergency", "contact"] as const;

export type ContactRole = (typeof CONTACT_ROLES)[number];