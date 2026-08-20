import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ashwini — Personal Health Instrument",
  description: "A private, decision-first personal health system.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
