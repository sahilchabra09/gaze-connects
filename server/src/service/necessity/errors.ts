export class NecessityDomainError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "NecessityDomainError";
    this.code = code;
    this.status = status;
  }
}

export function isNecessityDomainError(error: unknown): error is NecessityDomainError {
  return error instanceof NecessityDomainError;
}
