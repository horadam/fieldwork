"use client";
import { useRef, useState, type FormEvent } from "react";

export function AuthFormBody({
  available,
  signupsOpen = true,
  busy,
  onSubmit,
}: {
  available: boolean;
  // False on invite-only deployments: accounts are created by the owner.
  signupsOpen?: boolean;
  busy: boolean;
  // Resolves to "confirm-email" when the account needs confirming first.
  onSubmit: (
    credentials: { email: string; password: string },
    signup: boolean,
  ) => Promise<"signed-in" | "confirm-email" | "failed">;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [info, setInfo] = useState("");
  async function send(signup: boolean) {
    const fields = new FormData(form.current!);
    setInfo("");
    const outcome = await onSubmit(
      {
        email: String(fields.get("email")),
        password: String(fields.get("password")),
      },
      signup,
    );
    if (outcome === "confirm-email")
      setInfo("Check your email to confirm your account, then sign in.");
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(false);
  }
  return (
    <>
      {info && (
        <div role="status" className="notice">
          {info}
        </div>
      )}
      <div className="auth-intro">
        <p className="tiny muted">
          {!available
            ? "Live sign-in is not configured. Use the browser workspace; setup instructions are included with the source."
            : signupsOpen
              ? "Sign in or create an account. Email confirmation may be required."
              : "Accounts on this demo are invite-only. If you were given one, sign in below."}
        </p>
        {available && !signupsOpen && (
          <p className="tiny muted">
            Everything else works without an account: your records stay in this
            browser, Simulated preview needs no model, and you can run AI steps
            with your own OpenAI key from the model status in the header.
          </p>
        )}
      </div>
      <form className="form" ref={form} onSubmit={submit}>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            minLength={8}
            required
            autoComplete="current-password"
          />
        </label>
        <div className="actions">
          <button disabled={busy || !available} className="button">
            Sign in
          </button>
          {signupsOpen && (
            <button
              disabled={busy || !available}
              type="button"
              className="button secondary"
              onClick={() => {
                if (form.current!.reportValidity()) void send(true);
              }}
            >
              Create account
            </button>
          )}
        </div>
      </form>
    </>
  );
}
