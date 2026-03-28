function stripToDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function normalizePhoneNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Phone number is required");
  }

  const digits = stripToDigits(trimmed);
  if (digits.length < 8 || digits.length > 15) {
    throw new Error("Phone number must contain between 8 and 15 digits");
  }

  return `+${digits}`;
}

export function toTelegramPhoneNumber(value: string): string {
  return normalizePhoneNumber(value);
}
