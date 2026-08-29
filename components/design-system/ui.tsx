import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type StatusTone = "neutral" | "nutrition" | "recovery" | "training" | "warning" | "route";

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function buttonClassName(variant: ButtonVariant = "primary", className = "") {
  return cx("ds-button", `ds-button--${variant}`, className);
}

export function Button({ variant = "primary", className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClassName(variant, className)} {...props} />;
}

export function Status({ tone = "neutral", className = "", children, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone; children: ReactNode }) {
  return <span className={cx("ds-status", `ds-status--${tone}`, className)} {...props}>{children}</span>;
}

export function Eyebrow({ className = "", children, ...props }: HTMLAttributes<HTMLParagraphElement> & { children: ReactNode }) {
  return <p className={cx("ds-eyebrow", className)} {...props}>{children}</p>;
}
