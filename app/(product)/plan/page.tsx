import type { Metadata } from "next";
import { PlanScreen } from "@/components/product/plan-screen";

export const metadata: Metadata = {
  title: "Plan",
  description: "Saved decisions, routines, responses, and evidence-labeled reviews.",
};

export default function PlanPage() {
  return <PlanScreen />;
}
