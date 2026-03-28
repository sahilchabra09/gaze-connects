"use client";

import { useEffect, useEffectEvent, useState } from "react";

import { toBackendURL } from "@/lib/telegram/api-base";
import type { TelegramEventMap, TelegramEventType, TelegramLiveConnectionState } from "@/lib/telegram/types";

const TELEGRAM_EVENT_TYPES: TelegramEventType[] = [
  "ready",
  "heartbeat",
  "auth_state",
  "contact_updated",
  "chat_opened",
  "message_new",
  "message_sent",
];

type TelegramEventHandlers = {
  [TType in TelegramEventType]?: (data: TelegramEventMap[TType]) => void;
};

function parseEventData(data: string) {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

export function useTelegramEvents(handlers: TelegramEventHandlers = {}) {
  const [connectionState, setConnectionState] = useState<TelegramLiveConnectionState>("connecting");

  const onEvent = useEffectEvent((type: TelegramEventType, rawData: string) => {
    const data = parseEventData(rawData);
    const handler = handlers[type] as ((value: unknown) => void) | undefined;

    if (handler && data !== null) {
      handler(data);
    }
  });

  useEffect(() => {
    const eventSource = new EventSource(toBackendURL("/api/telegram/events"), {
      withCredentials: true,
    });

    const removeListeners = TELEGRAM_EVENT_TYPES.map((type) => {
      const listener = (event: MessageEvent<string>) => {
        if (type === "ready") {
          setConnectionState("open");
        }

        onEvent(type, event.data);
      };

      eventSource.addEventListener(type, listener as EventListener);

      return () => {
        eventSource.removeEventListener(type, listener as EventListener);
      };
    });

    eventSource.onopen = () => {
      setConnectionState("open");
    };

    eventSource.onerror = () => {
      setConnectionState("error");
    };

    return () => {
      removeListeners.forEach((remove) => remove());
      setConnectionState("closed");
      eventSource.close();
    };
  }, []);

  return connectionState;
}
