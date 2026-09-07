import type { HealthHistoryEntry } from "@/domain/advisor/types";

export function sourceDateLabel(
  entry: Pick<HealthHistoryEntry, "sourceDate" | "sourceDatePrecision">,
): string {
  if (!entry.sourceDate || entry.sourceDatePrecision === "unknown") return "Source date unknown";
  if (entry.sourceDatePrecision === "year") return entry.sourceDate.slice(0, 4);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    ...(entry.sourceDatePrecision === "month" ? {} : { day: "numeric" as const }),
    timeZone: "UTC",
  }).format(new Date(`${entry.sourceDate}T00:00:00Z`));
}
