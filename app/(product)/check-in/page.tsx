import type { Metadata } from "next";
import { CheckinScreen } from "@/components/product/checkin-screen";

export const metadata: Metadata = {
  title: "Check-in",
  description: "One intake, one saved record, and one coordinated next step.",
};

export default function CheckinPage() {
  return <CheckinScreen />;
}
