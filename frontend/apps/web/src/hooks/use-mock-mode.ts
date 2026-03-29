"use client";

import { useCallback } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { SyncStorage } from "jotai/vanilla/utils/atomWithStorage";

const MOCK_MODE_STORAGE_KEY = "gaze-connect-mock-mode";

type MockModeState = {
  mockEnabled: boolean;
  requiresCalibration: boolean;
};

const DEFAULT_MOCK_MODE_STATE: MockModeState = {
  mockEnabled: true,
  requiresCalibration: false,
};

const mockModeStorage: SyncStorage<MockModeState> = {
  getItem: (key: string, initialValue: MockModeState) => {
    if (typeof window === "undefined") {
      return initialValue;
    }

    const rawValue = window.localStorage.getItem(key);
    if (rawValue === null) {
      return initialValue;
    }

    if (rawValue === "true" || rawValue === "false") {
      return {
        mockEnabled: rawValue === "true",
        requiresCalibration: false,
      };
    }

    try {
      const parsed = JSON.parse(rawValue) as Partial<MockModeState>;
      return {
        mockEnabled: typeof parsed.mockEnabled === "boolean" ? parsed.mockEnabled : initialValue.mockEnabled,
        requiresCalibration: typeof parsed.requiresCalibration === "boolean"
          ? parsed.requiresCalibration
          : initialValue.requiresCalibration,
      };
    } catch {
      return initialValue;
    }
  },
  setItem: (key: string, value: MockModeState) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  },
  removeItem: (key: string) => {
    window.localStorage.removeItem(key);
  },
  subscribe: (
    key: string,
    callback: (value: MockModeState) => void,
    initialValue: MockModeState,
  ) => {
    const listener = (event: StorageEvent) => {
      if (event.key !== key) return;
      callback(mockModeStorage.getItem(key, initialValue));
    };

    window.addEventListener("storage", listener);
    return () => {
      window.removeEventListener("storage", listener);
    };
  },
};

const mockModeAtom = atomWithStorage<MockModeState>(
  MOCK_MODE_STORAGE_KEY,
  DEFAULT_MOCK_MODE_STATE,
  mockModeStorage,
  { getOnInit: true },
);

const setMockModeAtom = atom(
  null,
  (
    get,
    set,
    nextState: MockModeState | ((previousState: MockModeState) => MockModeState),
  ) => {
    const previousState = get(mockModeAtom);
    set(
      mockModeAtom,
      typeof nextState === "function" ? nextState(previousState) : nextState,
    );
  },
);

export function useMockMode() {
  const state = useAtomValue(mockModeAtom);
  const setState = useSetAtom(setMockModeAtom);

  const setMockModeState = useCallback((
    nextState: MockModeState | ((previousState: MockModeState) => MockModeState),
  ) => {
    setState(nextState);
  }, [setState]);

  const setMockEnabled = useCallback((
    nextValue: boolean | ((previousValue: boolean) => boolean),
    options?: { requiresCalibration?: boolean },
  ) => {
    setState((previousState) => {
      const mockEnabled = typeof nextValue === "function"
        ? nextValue(previousState.mockEnabled)
        : nextValue;

      return {
        mockEnabled,
        requiresCalibration: options?.requiresCalibration ?? previousState.requiresCalibration,
      };
    });
  }, [setState]);

  const toggleMockMode = useCallback(() => {
    setState((previousState) => ({
      ...previousState,
      mockEnabled: !previousState.mockEnabled,
    }));
  }, [setState]);

  const mockEnabled = state.mockEnabled;
  const requiresCalibration = state.requiresCalibration;

  return {
    mockEnabled,
    requiresCalibration,
    toggleMockMode,
    setMockEnabled,
    setMockModeState,
  };
}
