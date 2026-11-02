"use client";
import { useCallback, useEffect, useState } from "react";
import type { Request } from "@/lib/api-client";

export type AiStatus = {
  provider: "ollama" | "openai";
  model: string;
  ready: boolean;
  message: string;
};

// Reloads when the session changes, since hosted access depends on sign-in.
export function useAiStatus(request: Request, token: string) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const refresh = useCallback(async () => {
    try {
      setStatus(await request<AiStatus>("/api/ai/status"));
    } catch {
      setStatus(null);
    }
  }, [request]);
  useEffect(() => {
    void refresh();
  }, [token, refresh]);
  const label = status
    ? `${status.provider} · ${status.model}`
    : "configured model";
  return { status, refresh, label };
}
