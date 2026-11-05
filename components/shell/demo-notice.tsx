"use client";
import { useEffect, useState } from "react";

const DISMISSED = "fieldwork-demo-notice-dismissed-v1";

/**
 * Explains a hosted copy to visitors: what the sample data is, where their
 * own data goes, and the two ways to try the AI steps. Dismissal is a
 * per-browser convenience, so storage failures just show it again.
 */
export function DemoNotice({
  onAddKey,
  onOpenApplications,
}: {
  onAddKey: () => void;
  onOpenApplications: () => void;
}) {
  // Hidden until storage is read, so a dismissed notice never flashes.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED) === "true";
    } catch {
      /* Blocked storage: show it. */
    }
    setVisible(!dismissed);
  }, []);
  if (!visible) return null;
  function dismiss() {
    try {
      localStorage.setItem(DISMISSED, "true");
    } catch {
      /* Dismissed for this page view only. */
    }
    setVisible(false);
  }
  return (
    <section className="demo-notice" aria-labelledby="demo-notice-title">
      <div>
        <h2 id="demo-notice-title">About this demo</h2>
        <p>
          It starts with synthetic sample data. Anything you add (a resume,
          jobs, notes) is saved only in this browser.
        </p>
        <p>
          Try the full flow free with <strong>Simulated preview</strong> from an
          application&apos;s ⋯ menu, which uses no AI model. To run real AI
          steps, add <strong>your own OpenAI key</strong>: each step sends just
          the text it needs through this app&apos;s server to OpenAI, billed to
          your key and not stored here.
        </p>
        <div className="actions">
          <button className="button small" onClick={onAddKey}>
            Add your OpenAI key
          </button>
          <button
            className="button secondary small"
            onClick={onOpenApplications}
          >
            Open Applications
          </button>
        </div>
      </div>
      <button
        className="button secondary small icon-button"
        aria-label="Dismiss this notice"
        onClick={dismiss}
      >
        ×
      </button>
    </section>
  );
}
