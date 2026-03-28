declare module "tdl" {
  export function configure(options: { tdjson: unknown; verbosityLevel?: number }): void;

  export interface Client {
    invoke<T = unknown>(request: unknown): Promise<T>;
    on(event: string, handler: (payload: unknown) => void): void;
    connect?: () => Promise<void> | void;
    close?: () => Promise<void> | void;
  }

  export function createClient(options: Record<string, unknown>): Client;
}