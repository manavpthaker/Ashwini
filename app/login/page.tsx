"use client";

import { useState, type FormEvent } from "react";

/**
 * Placeholder sign-in page.
 *
 * Deliberately plain and self-contained — inline styles, no shared class names —
 * so the UI redesign can replace it wholesale without untangling it from
 * anything. The only part worth keeping is the contract: POST an email to
 * /api/auth/sign-in, then wait for the link.
 */

const ERROR_TEXT: Record<string, string> = {
  "missing-code": "That link was incomplete. Ask for a new one.",
  "exchange-failed": "That link has expired or was already used.",
  "not-permitted": "That account cannot open this record.",
  unavailable: "Sign-in is not configured on this deployment.",
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  const initialError =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("error");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    setState("sending");

    const next =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("next");

    const response = await fetch("/api/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, ...(next?.startsWith("/") ? { next } : {}) }),
    });

    setState(response.ok ? "sent" : "failed");
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ width: "100%", maxWidth: "360px" }}>
        <h1 style={{ fontSize: "20px", margin: "0 0 4px" }}>ashwini</h1>
        <p style={{ margin: "0 0 24px", color: "#666", fontSize: "14px" }}>
          A private health record. Sign in with the address on file.
        </p>

        {initialError && (
          <p style={{ color: "#a33", fontSize: "14px", margin: "0 0 16px" }}>
            {ERROR_TEXT[initialError] ?? "Something went wrong. Ask for a new link."}
          </p>
        )}

        {state === "sent" ? (
          <p style={{ fontSize: "14px" }}>
            If that address can sign in, a link is on its way. It opens this app directly.
          </p>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="email" style={{ display: "block", fontSize: "14px", marginBottom: 6 }}>
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              style={{
                width: "100%",
                // 16px or iOS zooms the whole page on focus.
                fontSize: "16px",
                padding: "10px",
                border: "1px solid #ccc",
                borderRadius: "6px",
                marginBottom: "12px",
              }}
            />
            <button
              type="submit"
              disabled={state === "sending" || !email.trim()}
              style={{
                width: "100%",
                fontSize: "16px",
                padding: "10px",
                borderRadius: "6px",
                border: "none",
                background: "#181a17",
                color: "white",
              }}
            >
              {state === "sending" ? "Sending…" : "Send sign-in link"}
            </button>
            {state === "failed" && (
              <p style={{ color: "#a33", fontSize: "14px", marginTop: 12 }}>
                Could not send a link just now. Try again shortly.
              </p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
