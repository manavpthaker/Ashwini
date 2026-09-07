import type { Metadata } from "next";
import { ContextScreen } from "@/components/product/context-screen";

export const metadata: Metadata = {
  title: "Health context",
  description: "Your saved health history, its sources, and what remains uncertain.",
};

export default function ContextPage() {
  return <ContextScreen />;
}
