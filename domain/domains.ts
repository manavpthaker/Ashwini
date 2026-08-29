/**
 * The learning domains from PRD 7. `system` covers outputs that belong to no
 * single domain — data-quality blocks, schedule notices, and route-outs that
 * leave the product's scope entirely.
 */
export const DOMAINS = ["training", "nutrition", "medication", "body", "focus", "system"] as const;

export type Domain = (typeof DOMAINS)[number];

export const DOMAIN_LABEL: Record<Domain, string> = {
  training: "Training and recovery",
  nutrition: "Nutrition",
  medication: "Medication",
  body: "Body and aesthetic",
  focus: "Mood and focus",
  system: "System",
};

export function isDomain(value: unknown): value is Domain {
  return typeof value === "string" && (DOMAINS as readonly string[]).includes(value);
}
