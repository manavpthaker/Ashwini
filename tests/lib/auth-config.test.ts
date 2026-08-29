import { describe, expect, it } from "vitest";
import {
  isAllowedEmail,
  permittedOnPublicHost,
  publicHost,
  readAuthConfig,
} from "@/lib/auth/config";

/**
 * The rule that decides where this app may run.
 *
 * Pure and exhaustively tested, because it is the single place that answers
 * "is the gate in front of us trustworthy here" — and getting it wrong means
 * a health record behind a check anyone can satisfy.
 */

const SUPABASE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  ASHWINI_ALLOWED_EMAILS: "owner@example.com",
};

describe("mode selection", () => {
  it("is supabase when url, key and an allowlist are all present", () => {
    expect(readAuthConfig(SUPABASE).mode).toBe("supabase");
  });

  it("falls back to tailscale when Supabase is not fully configured", () => {
    const config = readAuthConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      ASHWINI_TAILSCALE_USER: "owner@example.com",
    });
    expect(config.mode).toBe("tailscale");
  });

  it("is none when nothing is configured", () => {
    expect(readAuthConfig({}).mode).toBe("none");
  });

  it("does not count Supabase as configured without an allowlist", () => {
    // A project with no permitted address would admit any account that can sign
    // up to that Supabase project. Single-subject means the list is required.
    const config = readAuthConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    });
    expect(config.mode).toBe("none");
  });

  it("ignores blank and whitespace-only values", () => {
    const config = readAuthConfig({
      NEXT_PUBLIC_SUPABASE_URL: "   ",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      ASHWINI_ALLOWED_EMAILS: " , ,",
      ASHWINI_TAILSCALE_USER: "  ",
    });
    expect(config.mode).toBe("none");
    expect(config.allowedEmails).toEqual([]);
  });

  it("parses a multi-entry allowlist", () => {
    const config = readAuthConfig({
      ...SUPABASE,
      ASHWINI_ALLOWED_EMAILS: "Owner@Example.com, second@example.com ",
    });
    expect(config.allowedEmails).toEqual(["owner@example.com", "second@example.com"]);
  });
});

describe("publicHost", () => {
  it("recognises the hosts that serve from the internet", () => {
    expect(publicHost({ VERCEL: "1" })).toBe("Vercel");
    expect(publicHost({ AWS_LAMBDA_FUNCTION_NAME: "fn" })).toBe("AWS Lambda");
    expect(publicHost({ NETLIFY: "true" })).toBe("Netlify");
  });

  it("returns null on an ordinary host", () => {
    expect(publicHost({})).toBeNull();
  });
});

describe("permittedOnPublicHost", () => {
  it("permits a real session", () => {
    expect(permittedOnPublicHost(readAuthConfig(SUPABASE))).toBe(true);
  });

  it("refuses the Tailscale header gate", () => {
    // The header is injected by `tailscale serve`. Anywhere else the caller
    // supplies it, so it proves nothing.
    const config = readAuthConfig({
      ASHWINI_TAILSCALE_USER: "owner@example.com",
    });
    expect(permittedOnPublicHost(config)).toBe(false);
  });

  it("refuses an unconfigured app", () => {
    expect(permittedOnPublicHost(readAuthConfig({}))).toBe(false);
  });
});

describe("isAllowedEmail", () => {
  const config = readAuthConfig(SUPABASE);

  it("matches regardless of case or surrounding space", () => {
    expect(isAllowedEmail(config, "owner@example.com")).toBe(true);
    expect(isAllowedEmail(config, "  Owner@Example.COM  ")).toBe(true);
  });

  it("rejects anyone else", () => {
    expect(isAllowedEmail(config, "someone@else.com")).toBe(false);
  });

  it("rejects a missing address rather than treating it as a match", () => {
    expect(isAllowedEmail(config, null)).toBe(false);
    expect(isAllowedEmail(config, undefined)).toBe(false);
    expect(isAllowedEmail(config, "")).toBe(false);
  });
});
