import type { Metadata } from "next";
import { PlanScreen } from "@/components/product/plan-screen";

export const metadata: Metadata = {
  title: "Plan",
  description: "Current decisions, active routines, and evidence-labeled review.",
};

export default function PlanPage() {
  return <PlanScreen />;
}
