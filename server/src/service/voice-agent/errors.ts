export class VoiceAgentDomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "VoiceAgentDomainError";
  }
}

export function isVoiceAgentDomainError(error: unknown): error is VoiceAgentDomainError {
  return error instanceof VoiceAgentDomainError;
}
