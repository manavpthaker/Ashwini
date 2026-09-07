import { z } from "zod";

export const HEALTH_CONTEXT_CATEGORIES = [
  "condition",
  "medication_history",
  "supplement_history",
  "goal",
  "nutrition",
  "training",
  "sleep",
  "preference",
  "measurement",
  "care_context",
] as const;
export type HealthContextCategory = (typeof HEALTH_CONTEXT_CATEGORIES)[number];
export const SOURCE_DATE_PRECISIONS = ["day", "month", "year", "unknown"] as const;
export type SourceDatePrecision = (typeof SOURCE_DATE_PRECISIONS)[number];
export type HealthContextTemporalStatus = "historical" | "current" | "uncertain";

const key = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/);
const sourceDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  })
  .nullable();
const dated = {
  sourceDate,
  datePrecision: z.enum(SOURCE_DATE_PRECISIONS),
};

function validDatePrecision(value: {
  sourceDate: string | null;
  datePrecision: SourceDatePrecision;
}): boolean {
  if (value.sourceDate === null) return value.datePrecision === "unknown";
  if (value.datePrecision === "unknown") return false;
  if (value.datePrecision === "year") return value.sourceDate.endsWith("-01-01");
  if (value.datePrecision === "month") return value.sourceDate.endsWith("-01");
  return true;
}

const entrySchema = z
  .object({
    key,
    category: z.enum(HEALTH_CONTEXT_CATEGORIES),
    statement: z.string().trim().min(1).max(1200),
    sourceLocator: z.string().trim().min(1).max(1000),
    ...dated,
    temporalStatus: z.enum(["historical", "current", "uncertain"]),
    confirmationRequired: z.boolean(),
  })
  .strict()
  .refine(validDatePrecision, { message: "Source date and precision disagree." })
  .refine(
    (entry) =>
      !["medication_history", "supplement_history"].includes(entry.category) ||
      entry.confirmationRequired,
    { message: "Imported medication and supplement history requires confirmation." },
  );

const sourceSchema = z
  .object({
    key,
    label: z.string().trim().min(1).max(200),
    locator: z.string().trim().min(1).max(1000),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    /** Explicitly increment when correcting curation of unchanged source bytes. */
    revision: z.number().int().positive().max(1_000_000).default(1),
    ...dated,
    // Empty versions intentionally retire the previous version without erasing it.
    entries: z.array(entrySchema).max(2000),
  })
  .strict()
  .refine(validDatePrecision, { message: "Source date and precision disagree." })
  .refine(
    (source) => new Set(source.entries.map((entry) => entry.key)).size === source.entries.length,
    { message: "Entry keys must be unique within a source." },
  );

/**
 * This accepts curated assertions, never raw document bodies. The explicit
 * declaration is an import-review requirement, not an automated claim that a
 * classifier can reliably identify every therapy narrative.
 */
export const healthContextImportSchema = z
  .object({
    version: z.literal(1),
    containsTherapyNarrative: z.literal(false),
    sources: z.array(sourceSchema).min(1).max(100),
  })
  .strict()
  .refine(
    (value) => new Set(value.sources.map((source) => source.key)).size === value.sources.length,
    { message: "Source keys must be unique within an import." },
  )
  .refine(
    (value) => value.sources.reduce((sum, source) => sum + source.entries.length, 0) <= 2000,
    { message: "One import may contain at most 2000 assertions." },
  );

export type HealthContextImport = z.infer<typeof healthContextImportSchema>;
export type HealthContextSourceImport = HealthContextImport["sources"][number];

/** Validation errors deliberately do not echo health statements or file paths. */
export function parseHealthContextImport(value: unknown): HealthContextImport {
  const parsed = healthContextImportSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      "Invalid health-context import. Check the schema, dates, unique keys, confirmation flags, and therapy-narrative exclusion.",
    );
  }
  return parsed.data;
}
