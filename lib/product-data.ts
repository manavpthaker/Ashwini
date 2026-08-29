import type { DayEvent, PerspectiveContribution, RoutineSummary } from "@/lib/product-model";

export const basePerspectives: readonly PerspectiveContribution[] = [
  {
    role: "Nutrition",
    tone: "nutrition",
    state: "Leading now",
    summary: "Keep lunch familiar. Dal, rice, yogurt, or another meal you already tolerate well is enough; there is nothing to optimize right now.",
    basis: "Lunch is the only missing input before a 4:30 training session.",
    origin: "ashwini_synthesis",
  },
  {
    role: "Recovery",
    tone: "recovery",
    state: "Context, not a verdict",
    summary: "Six hours 18 minutes is below your usual range, but it does not decide the session by itself.",
    basis: "Short sleep is paired with normal energy and a quiet shoulder in the 10:12 check-in.",
    origin: "ashwini_synthesis",
  },
  {
    role: "Training",
    tone: "training",
    state: "Holding the call",
    summary: "Keep the 4:30 session on the calendar. Choose full or reduced volume at the 3:45 check-in.",
    basis: "The current rule waits for pre-session energy and shoulder status.",
    origin: "ashwini_synthesis",
  },
] as const;

export const baseDayEvents: readonly DayEvent[] = [
  { time: "7:36", domain: "Nutrition", title: "Breakfast recorded", detail: "Estimated 24–30 g protein", state: "complete" },
  { time: "8:03", domain: "Medication", title: "Morning dose noted", detail: "Supply count: 14", state: "complete" },
  { time: "10:12", domain: "Check-in", title: "Energy normal · shoulder quiet", detail: "Training remains on the calendar", state: "complete" },
  { time: "Now", domain: "Nutrition", title: "Lunch check-in", detail: "Needs your input", state: "current" },
  { time: "3:45", domain: "Recovery + training", title: "Energy and shoulder check", detail: "Choose full or reduced volume", state: "upcoming" },
  { time: "4:30", domain: "Training", title: "Upper-body session", detail: "Plan held", state: "upcoming" },
] as const;

export const routines: readonly RoutineSummary[] = [
  {
    id: "pre-training-meal",
    domain: "Nutrition + training",
    title: "Familiar meal before afternoon training",
    status: "Early signal",
    progress: "Day 24 · review in 6 days",
    behavior: "Use House Dal v1 or the named fallback before an eligible afternoon session.",
    target: "Complete the planned session without an unplanned reduction.",
    nextReview: "June 30 · minimum 10 comparable sessions",
    evidence: "5 of 6 target met with the routine · 1 of 4 without · 2 blocked windows retained",
    confounds: "Sleep debt, travel, illness, alcohol, unusual schedule, adherence gaps, and multiple interventions.",
  },
  {
    id: "caffeine-cutoff",
    domain: "Focus + sleep context",
    title: "No caffeine after 2 PM",
    status: "Tracking",
    progress: "Day 5 · blind collection",
    behavior: "Keep the existing morning routine and record only whether caffeine occurred after 2 PM.",
    target: "Next-day focus response during the 10 AM prompt.",
    nextReview: "July 12 · after 14 eligible days",
    evidence: "Six natural-variation windows were noticed before the routine began.",
    confounds: "Short sleep, alcohol, travel, illness, missed prompt, and unusually late work.",
  },
] as const;

export const weeklyReview = {
  status: "Early signal",
  gate: "Caveated",
  title: "The familiar pre-training meal is more reliable so far.",
  summary: "Comparable sessions with the routine have more often met the completion target. Continue tracking; this is not a causal claim.",
  allowed: "5 of 6 comparable sessions with the routine met the target.",
  refused: "House Dal v1 improves performance or contains an exact calorie amount.",
  nextReview: "June 30",
} as const;

export const evidenceDefinitions = [
  { status: "Recorded", meaning: "A source says this occurred. It is not yet an interpretation." },
  { status: "Rule-based", meaning: "A pre-agreed rule applies to the current facts." },
  { status: "Tracking", meaning: "One low-risk behavior is being deliberately repeated." },
  { status: "Early signal", meaning: "A small pattern appears, but material uncertainty remains." },
  { status: "Route out", meaning: "The question belongs with a qualified human specialist." },
] as const;
