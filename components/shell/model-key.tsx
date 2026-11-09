"use client";
import { useId, useMemo, useState, type FormEvent } from "react";
import { apiClient } from "@/lib/api-client";
import {
  DEFAULT_USER_MODEL,
  KEYS_URL,
  formatCost,
  modelPrice,
  PRICES_AS_OF,
  PRICING_URL,
  USAGE_URL,
  type SessionUsage,
} from "@/lib/pricing";
import { forgetUserKey, saveUserKey } from "@/lib/user-key";
import { useUserKeyState, type AiStatus } from "../hooks/use-ai-status";

const perMillion = (usd: number) => `$${usd.toFixed(2)}`;

// Price per 1M tokens for the model in use, with where the figures came from.
export function ModelPrice({ ai }: { ai: AiStatus }) {
  const price = modelPrice(ai.provider, ai.model);
  if (ai.provider === "ollama")
    return <p className="tiny">Runs on this computer · no API cost.</p>;
  return (
    <p className="tiny">
      {price
        ? `${perMillion(price.input)} input / ${perMillion(price.output)} output per 1M tokens (OpenAI prices as of ${PRICES_AS_OF}). `
        : `${ai.model} isn't in this app's price table, so only token counts are shown. `}
      <a href={PRICING_URL} target="_blank" rel="noreferrer">
        OpenAI pricing
      </a>
      {ai.source === "user" && (
        <>
          {" · "}
          <a href={USAGE_URL} target="_blank" rel="noreferrer">
            Your usage dashboard
          </a>
        </>
      )}
    </p>
  );
}

export function SessionTotal({ usage }: { usage: SessionUsage }) {
  if (!usage.calls) return null;
  const tokens = `${usage.inputTokens.toLocaleString("en-US")} in / ${usage.outputTokens.toLocaleString("en-US")} out tokens`;
  const priced = usage.calls - usage.unpriced;
  return (
    <p className="tiny">
      <strong>This session:</strong> {usage.calls}{" "}
      {usage.calls === 1 ? "call" : "calls"} · {tokens}
      {priced > 0 && ` · ≈ ${formatCost(usage.cost)}`}
      {usage.unpriced > 0 &&
        priced > 0 &&
        ` (${usage.unpriced} without a known price)`}
      . Estimates only; your provider's usage page is the bill.
    </p>
  );
}

type Models = { priced: string[]; unpriced: string[] };
const keyPattern = /^sk-[A-Za-z0-9_-]{20,300}$/;

// The key's state in the status panel, with a way to set it up or change it.
// Setting up happens in KeyForm, opened in a dialog.
export function KeySummary({ onSetUp }: { onSetUp: () => void }) {
  const { userKey, remember } = useUserKeyState();
  return userKey ? (
    <div className="tiny model-key">
      <p>
        <strong>Your OpenAI key</strong> (…{userKey.key.slice(-4)}) is in use
        with {userKey.model}. It&apos;s kept{" "}
        {remember ? "on this device" : "until this tab closes"}.
      </p>
      <div className="actions">
        <button className="button secondary small" onClick={onSetUp}>
          Change
        </button>
        <button className="button secondary small" onClick={forgetUserKey}>
          Forget key
        </button>
      </div>
    </div>
  ) : (
    <div className="model-key">
      <button className="button secondary small" onClick={onSetUp}>
        Use your own OpenAI key
      </button>
    </div>
  );
}

/**
 * Lets a visitor run AI steps on their own OpenAI key, kept in this browser.
 * The key is checked first by listing its models (free), and the visitor then
 * picks from the models that key can use and whose price the app knows.
 */
export function KeyForm({ onDone }: { onDone: () => void }) {
  const { userKey, remember } = useUserKeyState();
  const [problem, setProblem] = useState("");
  const [checking, setChecking] = useState(false);
  // The key that was checked and the models it can use.
  const [checked, setChecked] = useState<{
    key: string;
    models: Models;
  } | null>(null);
  const [choice, setChoice] = useState("");
  const request = useMemo(() => apiClient(() => ""), []);
  const id = useId();

  async function check(key: string) {
    if (!keyPattern.test(key))
      return setProblem("Paste an OpenAI API key; it starts with sk-.");
    setChecking(true);
    setProblem("");
    try {
      const models = await request<Models>("/api/ai/models", {
        userKey: { key, model: DEFAULT_USER_MODEL },
      });
      setChecked({ key, models });
      const preferred = [userKey?.model, DEFAULT_USER_MODEL].find(
        (m) => m && models.priced.includes(m),
      );
      setChoice(preferred ?? models.priced[0] ?? "");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not check the key.");
    } finally {
      setChecking(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    if (!checked) {
      // A blank field while changing settings keeps the saved key.
      const typed = String(fields.get("key") || "").trim();
      return void check(typed || userKey?.key || "");
    }
    if (!choice) return;
    saveUserKey(
      { key: checked.key, model: choice },
      fields.get("remember") === "on",
    );
    onDone();
  }

  return (
    <form className="form" onSubmit={submit}>
      <p className="tiny">
        Your key is sent to this app&apos;s server with each AI request and
        passed straight to OpenAI. The server doesn&apos;t store or log it. You
        pay OpenAI for what you use.
      </p>
      <p className="tiny">
        <strong>Use a limited key:</strong> create one in a separate OpenAI
        project with a monthly budget, and revoke it when you&apos;re done.{" "}
        <a href={KEYS_URL} target="_blank" rel="noreferrer">
          OpenAI API keys
        </a>
      </p>
      {problem && (
        <p role="alert" className="notice error">
          {problem}
        </p>
      )}
      <label>
        OpenAI API key
        <input
          name="key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          required={!userKey}
          disabled={checking}
          onChange={() => setChecked(null)}
          placeholder={
            userKey ? `…${userKey.key.slice(-4)} (leave blank to keep)` : "sk-…"
          }
        />
      </label>
      {checked &&
        (checked.models.priced.length ? (
          <>
            <label>
              Model
              <select
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
                aria-describedby={`${id}-prices`}
              >
                {checked.models.priced.map((model) => {
                  const price = modelPrice("openai", model)!;
                  return (
                    <option key={model} value={model}>
                      {model} · {perMillion(price.input)} /{" "}
                      {perMillion(price.output)}
                      {model === DEFAULT_USER_MODEL ? " · suggested" : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <p className="tiny muted" id={`${id}-prices`}>
              The models this key can use, cheapest first. Prices are per 1M
              input / output tokens, as of {PRICES_AS_OF}.
              {checked.models.unpriced.length > 0 &&
                ` Not listed because this app has no price for them yet: ${checked.models.unpriced.join(", ")}.`}
            </p>
            <label className="inline">
              <input
                type="checkbox"
                name="remember"
                defaultChecked={remember}
              />
              Remember on this device
            </label>
          </>
        ) : (
          <p role="alert" className="notice error">
            This key works, but it can&apos;t use any model this app has a price
            for. Check the key&apos;s project and model access.
          </p>
        ))}
      <div className="actions">
        <button
          className="button small"
          type="submit"
          disabled={checking || (!!checked && !checked.models.priced.length)}
        >
          {checking ? "Checking…" : checked ? "Use this key" : "Check key"}
        </button>
        <button
          className="button secondary small"
          type="button"
          onClick={onDone}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
