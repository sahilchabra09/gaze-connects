type VoiceAgentEvent = {
  type: string;
  sessionId: string;
  data: unknown;
};

type VoiceAgentSubscriber = (event: VoiceAgentEvent) => void;

class VoiceAgentSseBroker {
  private readonly subscribers = new Map<string, Set<VoiceAgentSubscriber>>();

  subscribe(sessionId: string, subscriber: VoiceAgentSubscriber) {
    const sessionSubscribers = this.subscribers.get(sessionId) ?? new Set<VoiceAgentSubscriber>();
    sessionSubscribers.add(subscriber);
    this.subscribers.set(sessionId, sessionSubscribers);

    return () => {
      const current = this.subscribers.get(sessionId);
      if (!current) return;
      current.delete(subscriber);
      if (current.size === 0) {
        this.subscribers.delete(sessionId);
      }
    };
  }

  publish(sessionId: string, type: string, data: unknown) {
    const current = this.subscribers.get(sessionId);
    if (!current) return;

    for (const subscriber of current) {
      subscriber({ type, sessionId, data });
    }
  }
}

export const voiceAgentSseBroker = new VoiceAgentSseBroker();
