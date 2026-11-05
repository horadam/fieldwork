"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ApiError, type Request } from "@/lib/api-client";
import {
  getUserKeyState,
  subscribeUserKey,
  type UserKeyState,
} from "@/lib/user-key";

export type AiStatus = {
  provider: "ollama" | "openai";
  model: string;
  ready: boolean;
  message: string;
  // "user" when the visitor's own OpenAI key is in use.
  source?: "user";
  // False when this visitor may not run any model (no account or key).
  allowed?: boolean;
  // The account-less local development mode; false on hosted copies.
  local?: boolean;
};

const serverSnapshot: UserKeyState = {
  userKey: null,
  remember: false,
  usage: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, unpriced: 0 },
};
export const useUserKeyState = () =>
  useSyncExternalStore(subscribeUserKey, getUserKeyState, () => serverSnapshot);

// Reloads when the session or the visitor's key changes, since hosted access
// depends on both.
export function useAiStatus(request: Request, token: string) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [problem, setProblem] = useState("");
  const { userKey } = useUserKeyState();
  const refresh = useCallback(async () => {
    try {
      setStatus(await request<AiStatus>("/api/ai/status"));
      setProblem("");
    } catch (e) {
      setStatus(null);
      setProblem(e instanceof ApiError ? e.message : "");
    }
  }, [request]);
  useEffect(() => {
    void refresh();
  }, [token, userKey?.key, userKey?.model, refresh]);
  const label = status
    ? `${status.provider} · ${status.model}`
    : "configured model";
  return { status, problem, refresh, label };
}
