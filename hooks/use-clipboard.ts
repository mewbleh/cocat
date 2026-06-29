"use client";

import { useCallback, useState } from "react";

type ClipboardStatus = "idle" | "copied" | "failed";

export function useClipboard(resetAfterMs = 1600) {
  const [status, setStatus] = useState<ClipboardStatus>("idle");

  const copy = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setStatus("copied");
        window.setTimeout(() => setStatus("idle"), resetAfterMs);
        return true;
      } catch {
        setStatus("failed");
        window.setTimeout(() => setStatus("idle"), resetAfterMs);
        return false;
      }
    },
    [resetAfterMs]
  );

  return { copy, status };
}
