// A visitor's own OpenAI key and this session's usage, held only in this
// browser. The key goes to this app's API routes, which pass it to OpenAI for
// one request and never store it.
import {
  addUsage,
  emptyUsage,
  type CallRecord,
  type SessionUsage,
} from "./pricing";

export type UserKey = { key: string; model: string };
// Request headers that carry the key and model to the app's API routes.
export const USER_KEY_HEADER = "x-openai-key";
export const USER_MODEL_HEADER = "x-openai-model";
export type UserKeyState = {
  userKey: UserKey | null;
  // Kept in localStorage across sessions instead of only this tab.
  remember: boolean;
  usage: SessionUsage;
};

const KEY_ITEM = "fieldwork-openai-key-v1";
const USAGE_ITEM = "fieldwork-session-usage-v1";
const listeners = new Set<() => void>();
let state: UserKeyState | null = null;

// Storage can be missing or throw (private windows, blocked site data).
function storage(kind: "session" | "local"): Storage | null {
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}
function read<T>(store: Storage | null, item: string): T | null {
  try {
    const raw = store?.getItem(item);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(store: Storage | null, item: string, value: unknown) {
  try {
    if (value === null) store?.removeItem(item);
    else store?.setItem(item, JSON.stringify(value));
  } catch {
    /* The key still works for this page; it just isn't kept. */
  }
}
const validKey = (value: unknown): value is UserKey =>
  !!value &&
  typeof (value as UserKey).key === "string" &&
  typeof (value as UserKey).model === "string";

export function getUserKeyState(): UserKeyState {
  if (state) return state;
  if (typeof window === "undefined")
    return { userKey: null, remember: false, usage: emptyUsage };
  const session = read<UserKey>(storage("session"), KEY_ITEM);
  const local = read<UserKey>(storage("local"), KEY_ITEM);
  state = {
    userKey: validKey(session) ? session : validKey(local) ? local : null,
    remember: !validKey(session) && validKey(local),
    usage: {
      ...emptyUsage,
      ...read<SessionUsage>(storage("session"), USAGE_ITEM),
    },
  };
  return state;
}
function set(next: UserKeyState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export const getUserKey = () => getUserKeyState().userKey;

export function saveUserKey(userKey: UserKey, remember: boolean) {
  write(storage("session"), KEY_ITEM, remember ? null : userKey);
  write(storage("local"), KEY_ITEM, remember ? userKey : null);
  set({ ...getUserKeyState(), userKey, remember });
}

// Removes the key everywhere and resets the session total.
export function forgetUserKey() {
  write(storage("session"), KEY_ITEM, null);
  write(storage("local"), KEY_ITEM, null);
  write(storage("session"), USAGE_ITEM, null);
  set({ userKey: null, remember: false, usage: emptyUsage });
}

export function recordUsage(call: CallRecord) {
  const usage = addUsage(getUserKeyState().usage, call);
  write(storage("session"), USAGE_ITEM, usage);
  set({ ...getUserKeyState(), usage });
}

export function subscribeUserKey(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// For tests: drop the cached state so the next read comes from storage.
export function resetUserKeyCache() {
  state = null;
}
