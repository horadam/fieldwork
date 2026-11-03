"use client";
import { useId, useState, type FormEvent } from "react";
import {
  DEFAULT_USER_MODEL,
  formatCost,
  modelPrice,
  PRICED_MODELS,
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

// Lets a visitor run AI steps on their own OpenAI key, kept in this browser.
export function ModelKey() {
  const { userKey, remember } = useUserKeyState();
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState("");
  const id = useId();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const key = String(fields.get("key") || "").trim();
    const model = String(fields.get("model") || "").trim();
    if (!/^sk-[A-Za-z0-9_-]{20,300}$/.test(key))
      return setInvalid("Paste an OpenAI API key; it starts with sk-.");
    if (!/^[a-z0-9][a-z0-9._:-]{0,63}$/i.test(model))
      return setInvalid("Enter an OpenAI model name, such as gpt-6.1-terra.");
    saveUserKey({ key, model }, fields.get("remember") === "on");
    setInvalid("");
    setEditing(false);
  }

  if (!editing)
    return userKey ? (
      <div className="tiny model-key">
        <p>
          <strong>Your OpenAI key</strong> (…{userKey.key.slice(-4)}) is in use
          with {userKey.model}. It&apos;s kept{" "}
          {remember ? "on this device" : "until this tab closes"}.
        </p>
        <div className="actions">
          <button
            className="button secondary small"
            onClick={() => setEditing(true)}
          >
            Change
          </button>
          <button className="button secondary small" onClick={forgetUserKey}>
            Forget key
          </button>
        </div>
      </div>
    ) : (
      <div className="model-key">
        <button
          className="button secondary small"
          onClick={() => setEditing(true)}
        >
          Use your own OpenAI key
        </button>
      </div>
    );

  return (
    <form className="form model-key" onSubmit={submit}>
      <p className="tiny">
        Your key is sent to this app&apos;s server with each AI request and
        passed straight to OpenAI. The server doesn&apos;t store or log it. You
        pay OpenAI for what you use.
      </p>
      {invalid && (
        <p role="alert" className="notice error">
          {invalid}
        </p>
      )}
      <label>
        OpenAI API key
        <input
          name="key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          required
          placeholder="sk-…"
        />
      </label>
      <label>
        Model
        <input
          name="model"
          list={`${id}-models`}
          defaultValue={userKey?.model || DEFAULT_USER_MODEL}
          spellCheck={false}
          required
        />
        <datalist id={`${id}-models`}>
          {PRICED_MODELS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <label className="inline">
        <input type="checkbox" name="remember" defaultChecked={remember} />
        Remember on this device
      </label>
      <div className="actions">
        <button className="button small" type="submit">
          Use this key
        </button>
        <button
          className="button secondary small"
          type="button"
          onClick={() => {
            setInvalid("");
            setEditing(false);
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
