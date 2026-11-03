"use client";
import { useUserKeyState, type AiStatus } from "../hooks/use-ai-status";
import { ModelKey, ModelPrice, SessionTotal } from "./model-key";

export function Topbar({
  section,
  mode,
  email,
  ai,
  aiProblem,
  onRefreshStatus,
  onSignIn,
  onSignOut,
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
}) {
  const { usage } = useUserKeyState();
  return (
    <div className="topbar">
      <p>
        CAREER WORKSPACE <span className="muted">/ {section}</span>
      </p>
      <div className="actions">
        <details className="status-pill">
          <summary>
            <span
              className={`status-dot ${ai?.ready ? "ready" : ""}`}
              aria-hidden="true"
            />
            {email || "Browser storage"} ·{" "}
            {ai
              ? `${ai.provider} ${ai.model}${ai.source === "user" ? " (your key)" : ""} ${ai.ready ? "ready" : "unavailable"}`
              : "model status unavailable"}
          </summary>
          <div className="status-panel">
            <p className="tiny">
              <strong>
                {mode === "demo" ? "Browser workspace" : "Private workspace"}
              </strong>
              <br />
              {mode === "demo"
                ? "Records are saved in this browser. Real analysis sends the selected JD and experience to the model below. Simulated preview calls no model."
                : `Signed in as ${email}. Records are saved to your Supabase workspace.`}
            </p>
            <p className="tiny">
              <strong>
                {ai
                  ? `${ai.provider} · ${ai.model}`
                  : "Model status unavailable"}
              </strong>
              {(ai?.message || aiProblem) && (
                <>
                  <br />
                  {ai?.message || aiProblem}
                </>
              )}
            </p>
            {ai && <ModelPrice ai={ai} />}
            <SessionTotal usage={usage} />
            <button
              className="button secondary small"
              onClick={onRefreshStatus}
            >
              Refresh model status
            </button>
            <ModelKey />
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
