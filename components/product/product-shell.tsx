"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { CheckinIcon, HomeIcon, PlanIcon, ShieldIcon } from "@/components/product/icons";
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
  const pathname = usePathname();
  const activePath = normalizedPath(pathname);
  const previousPath = useRef(pathname);
  const activeLabel = navigation.find((item) => normalizedPath(item.href) === activePath)?.label ?? "Ashwini";

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;

    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("#page-title")?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  return (
    <div className={styles.appFrame}>
      <a className="skip-link" href="#main-content">Skip to main content</a>

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
          <span className={styles.previewPill}><i aria-hidden="true" />Private record</span>
          <details className={styles.boundaryMenu}>
            <summary><ShieldIcon />Lifestyle guidance</summary>
            <div>
              <strong>Bounded personal guidance</strong>
              <p>Ashwini supports low-risk lifestyle and training decisions. Diagnosis, prescription changes, and urgent or worsening symptoms go to a qualified human professional.</p>
            </div>
          </details>
          <span className={styles.avatar} aria-label="Personal workspace">MP</span>
        </div>
      </header>

      <p className="sr-only" aria-live="polite">{activeLabel} view</p>
      <main className={styles.workspace} id="main-content">{children}</main>

      <footer className={styles.footer}>
        <span><ShieldIcon />Lifestyle guidance · human specialist for clinical decisions</span>
        <span>Your check-ins are saved · routines and review are still fixtures</span>
      </footer>

      <nav className={styles.mobileNav} aria-label="Mobile primary navigation">
        {navigation.map((item) => {
          const Icon = item.icon;
          const active = normalizedPath(item.href) === activePath;
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
              <Icon /><span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
