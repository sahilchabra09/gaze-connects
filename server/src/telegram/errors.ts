export class TelegramDomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TelegramDomainError";
  }
}

export function isTelegramDomainError(error: unknown): error is TelegramDomainError {
  return error instanceof TelegramDomainError;
}
