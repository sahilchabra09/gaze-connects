import type { Subscriber } from "./types";

export class TelegramSseBroker {
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  subscribe(patientId: string, subscriber: Subscriber): () => void {
    const subscribers = this.subscribers.get(patientId) ?? new Set<Subscriber>();
    subscribers.add(subscriber);
    this.subscribers.set(patientId, subscribers);

    return () => {
      const current = this.subscribers.get(patientId);
      if (!current) {
        return;
      }

      current.delete(subscriber);
      if (current.size === 0) {
        this.subscribers.delete(patientId);
      }
    };
  }

  publish(patientId: string, type: string, data: unknown): void {
    const subscribers = this.subscribers.get(patientId);
    if (!subscribers) {
      return;
    }

    for (const subscriber of subscribers) {
      subscriber({ type, data });
    }
  }
}

export const telegramSseBroker = new TelegramSseBroker();
