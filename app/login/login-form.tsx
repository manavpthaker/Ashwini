"use client";

import { useState, type FormEvent } from "react";
import { ShieldIcon } from "@/components/product/icons";
import styles from "./login.module.css";

const ERROR_TEXT: Record<string, string> = {
  "missing-code": "That link was incomplete. Request a new one.",
  "exchange-failed": "That link has expired or was already used.",
  "not-permitted": "That account cannot open this record.",
  unavailable: "Sign-in is not configured on this deployment.",
};

export function LoginForm({ errorCode, next }: { errorCode: string | null; next: string | null }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [showInitialError, setShowInitialError] = useState(Boolean(errorCode));

  async function sendLink() {
    if (!email.trim()) return;
    setShowInitialError(false);
    setState("sending");

    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, ...(next ? { next } : {}) }),
      });
      setState(response.ok ? "sent" : "failed");
    } catch {
      setState("failed");
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendLink();
  }

  const errorMessage = showInitialError && errorCode
    ? (ERROR_TEXT[errorCode] ?? "Something went wrong. Request a new link.")
    : state === "failed"
      ? "Could not send a link just now. Try again shortly."
      : null;

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="login-title">
        <div className={styles.introduction}>
          <div className={styles.wordmark}>
            ashwini<span aria-hidden="true">•</span>
          </div>
          <div className={styles.introCopy}>
            <p className={styles.eyebrow}>Your private health record</p>
            <h1 id="login-title">Return to what matters now.</h1>
            <p>
              One place for check-ins, current decisions, routines, and the evidence attached to
              them—without pretending unknowns are facts.
            </p>
          </div>
          <div className={styles.boundary}>
            <ShieldIcon />
            <span>
              <strong>Bounded guidance</strong>
              Clinical decisions and urgent concerns belong with a qualified professional;
              Ashwini does not send a handoff.
            </span>
          </div>
        </div>

        <div className={styles.signInPanel}>
          <div>
            <p className={styles.eyebrow}>Secure sign-in</p>
            <h2>Open your record</h2>
            <p className={styles.panelCopy}>
              Enter the address on file. We’ll send a one-time sign-in link—no password to
              remember.
            </p>
          </div>

          {state === "sent" ? (
            <div className={styles.sent} role="status">
              <span aria-hidden="true">✓</span>
              <div>
                <strong>Check your inbox</strong>
                <p>
                  If that address can sign in, a link is on its way. It opens this record directly.
                </p>
                <div className={styles.sentActions}>
                  <button type="button" onClick={() => void sendLink()}>
                    Send another link
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail("");
                      setState("idle");
                    }}
                  >
                    Use a different address
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <form className={styles.form} onSubmit={submit}>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setShowInitialError(false);
                }}
                aria-describedby={errorMessage ? "login-error" : "login-help"}
              />
              <p id="login-help">Use the address approved for this single-owner record.</p>
              <button type="submit" disabled={state === "sending" || !email.trim()}>
                {state === "sending" ? "Sending secure link…" : "Send sign-in link"}
              </button>
            </form>
          )}

          <div className={styles.messageSlot} aria-live="polite">
            {errorMessage ? (
              <p className={styles.error} id="login-error" role="alert">
                {errorMessage}
              </p>
            ) : null}
          </div>

          <p className={styles.privacyNote}>
            This email identifies the approved account and receives the one-time sign-in link.
          </p>
        </div>
      </section>
    </main>
  );
}
