"use client";
import type { AiStatus } from "../hooks/use-ai-status";

export function Topbar({
  section,
  mode,
  email,
  ai,
  onRefreshStatus,
  onSignIn,
  onSignOut,
}: {
  section: string;
  mode: "demo" | "live";
  email: string;
  ai: AiStatus | null;
  onRefreshStatus: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
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
              ? `${ai.provider} ${ai.model} ${ai.ready ? "ready" : "unavailable"}`
              : "model status unavailable"}
          </summary>
          <div className="status-panel">
            <p className="tiny">
              <strong>
                {mode === "demo" ? "Browser workspace" : "Private workspace"}
              </strong>
              <br />
              {mode === "demo"
                ? "Records are saved in this browser. Real analysis sends the selected JD and experience to the configured model. Simulated preview calls no model."
                : `Signed in as ${email}. Records are saved to your Supabase workspace.`}
            </p>
            <p className="tiny">
              <strong>
                {ai
                  ? `${ai.provider} · ${ai.model}`
                  : "Model status unavailable"}
              </strong>
              {ai?.message && (
                <>
                  <br />
                  {ai.message}
                </>
              )}
            </p>
            <button
              className="button secondary small"
              onClick={onRefreshStatus}
            >
              Refresh model status
            </button>
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
