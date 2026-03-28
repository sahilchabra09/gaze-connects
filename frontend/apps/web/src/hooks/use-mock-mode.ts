"use client";

import { useEffect, useState } from "react";

const MOCK_MODE_STORAGE_KEY = "gaze-connect-mock-mode";

export function useMockMode(defaultValue = true) {
  const [mockEnabled, setMockEnabled] = useState(() => {
    if (typeof window === "undefined") {
      return defaultValue;
    }

    const rawValue = window.localStorage.getItem(MOCK_MODE_STORAGE_KEY);
    return rawValue === null ? defaultValue : rawValue === "true";
  });

  useEffect(() => {
    window.localStorage.setItem(MOCK_MODE_STORAGE_KEY, String(mockEnabled));
  }, [mockEnabled]);

  return {
    mockEnabled,
    toggleMockMode: () => setMockEnabled((value) => !value),
    setMockEnabled,
  };
}
