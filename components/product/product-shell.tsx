"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckinIcon, HomeIcon, PlanIcon, ShieldIcon } from "@/components/product/icons";
import { useProduct } from "@/components/product/product-provider";
import styles from "./product-shell.module.css";

const navigation = [
  { href: "/", label: "Today", icon: HomeIcon },
  { href: "/check-in/", label: "Check-in", icon: CheckinIcon },
  { href: "/plan/", label: "Plan", icon: PlanIcon },
] as const;

function normalizedPath(pathname: string) {
  if (pathname !== "/" && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

export function ProductShell({ children }: { children: ReactNode }) {
  const { loading: recordLoading, error: recordError } = useProduct();
  const router = useRouter();
  const pathname = usePathname();
  const activePath = normalizedPath(pathname);
  const previousPath = useRef(pathname);
  const activeLabel =
    navigation.find((item) => normalizedPath(item.href) === activePath)?.label ?? "Ashwini";
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const recordStatus = recordLoading
    ? "Opening record"
    : recordError
      ? "Record unavailable"
      : "Private record";

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;

    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("#page-title")?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  const signOut = async () => {
    setSigningOut(true);
    setSignOutError(false);
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST" });
      if (response.ok) router.replace("/login");
      else setSignOutError(true);
    } catch {
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className={styles.appFrame}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className={styles.topbar}>
        <Link className={styles.wordmark} href="/" aria-label="Ashwini Today">
          ashwini<span aria-hidden="true">•</span>
        </Link>

        <nav className={styles.desktopNav} aria-label="Primary navigation">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={normalizedPath(item.href) === activePath ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.headerStatus}>
          <span className={styles.previewPill} aria-live="polite">
            <i aria-hidden="true" />
            {recordStatus}
          </span>
          <details className={styles.boundaryMenu}>
            <summary>
              <ShieldIcon />
              Lifestyle guidance
            </summary>
            <div>
              <strong>Bounded personal guidance</strong>
              <p>
                Ashwini supports low-risk lifestyle and training decisions. Diagnosis, prescription
                changes, and urgent or worsening symptoms go to a qualified human professional.
              </p>
            </div>
          </details>
          <button
            className={styles.accountAction}
            type="button"
            disabled={signingOut}
            onClick={() => void signOut()}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </header>

      {signOutError ? (
        <p className={styles.signOutError} role="alert">
          Sign-out failed. This private session may still be active; try again before leaving the
          device.
        </p>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {activeLabel} view
      </p>
      <main className={styles.workspace} id="main-content">
        {children}
      </main>

      <footer className={styles.footer}>
        <span>
          <ShieldIcon />
          Lifestyle guidance · human specialist for clinical decisions
        </span>
        <span>{recordStatus} · only saved records appear</span>
      </footer>

      <nav className={styles.mobileNav} aria-label="Mobile primary navigation">
        {navigation.map((item) => {
          const Icon = item.icon;
          const active = normalizedPath(item.href) === activePath;
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
              <Icon />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <button
          className={styles.mobileSignOut}
          type="button"
          disabled={signingOut}
          onClick={() => void signOut()}
        >
          <ShieldIcon />
          <span>{signingOut ? "Signing out…" : "Sign out"}</span>
        </button>
      </nav>
    </div>
  );
}
