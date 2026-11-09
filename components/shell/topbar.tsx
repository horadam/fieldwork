"use client";
import { useEffect, useRef } from "react";
import { useUserKeyState, type AiStatus } from "../hooks/use-ai-status";
import { KeySummary, ModelPrice, SessionTotal } from "./model-key";

export function Topbar({
  section,
  mode,
  email,
  ai,
  aiProblem,
  onRefreshStatus,
  onSignIn,
  onSignOut,
  statusOpen,
  onStatusToggle,
  onSetUpKey,
}: {
  section: string;
  mode: "demo" | "live";
  email: string;
  ai: AiStatus | null;
  // Why status could not be loaded, e.g. a rejected key format.
  aiProblem: string;
  onRefreshStatus: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  // The model panel is controlled so the demo notice can open it.
  statusOpen: boolean;
  onStatusToggle: (open: boolean) => void;
  // Opens the key dialog; the panel itself only summarises the key.
  onSetUpKey: () => void;
}) {
  const pill = useRef<HTMLDetailsElement>(null);
  // A glance panel: it closes on an outside click, on Escape (returning
  // focus to the pill), and once the pill scrolls out of view.
  useEffect(() => {
    if (!statusOpen) return;
    const root = pill.current!;
    const outside = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) onStatusToggle(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onStatusToggle(false);
      root.querySelector("summary")?.focus();
    };
    const visible =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            if (!entry.isIntersecting) onStatusToggle(false);
          });
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    visible?.observe(root);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      visible?.disconnect();
    };
  }, [statusOpen, onStatusToggle]);
  const { usage } = useUserKeyState();
  // No model this visitor may use, e.g. a hosted copy without a key.
  const noModel = ai?.allowed === false;
  return (
    <div className="topbar">
      <p>
        CAREER WORKSPACE <span className="muted">/ {section}</span>
      </p>
      <div className="actions">
        <details
          ref={pill}
          className="status-pill"
          open={statusOpen}
          onToggle={(e) => onStatusToggle(e.currentTarget.open)}
        >
          <summary>
            <span
              className={`status-dot ${ai?.ready ? "ready" : ""}`}
              aria-hidden="true"
            />
            {email || "Browser storage"} ·{" "}
            {!ai
              ? "model status unavailable"
              : noModel
                ? "No AI model · add your key"
                : `${ai.provider} ${ai.model}${ai.source === "user" ? " (your key)" : ""} ${ai.ready ? "ready" : "unavailable"}`}
          </summary>
          <div className="status-panel">
            <p className="tiny">
              <strong>
                {mode === "demo" ? "Browser workspace" : "Private workspace"}
              </strong>
              <br />
              {mode === "demo"
                ? "Records are saved in this browser. AI steps send only the text they need to the AI model. Simulated preview calls no model."
                : `Signed in as ${email}. Records are saved to your Supabase workspace.`}
            </p>
            <p className="tiny">
              <strong>
                {!ai
                  ? "Model status unavailable"
                  : noModel
                    ? "No AI model available"
                    : `${ai.provider} · ${ai.model}`}
              </strong>
              {(ai?.message || aiProblem) && (
                <>
                  <br />
                  {ai?.message || aiProblem}
                </>
              )}
            </p>
            {ai && !noModel && <ModelPrice ai={ai} />}
            <SessionTotal usage={usage} />
            <button
              className="button secondary small"
              onClick={onRefreshStatus}
            >
              Refresh model status
            </button>
            <KeySummary onSetUp={onSetUpKey} />
          </div>
        </details>
        {mode === "live" ? (
          <button className="button secondary small" onClick={onSignOut}>
            Sign out
          </button>
        ) : (
          <button className="button secondary small" onClick={onSignIn}>
            Sign in
          </button>
        )}
      </div>
    </div>
  );
}
