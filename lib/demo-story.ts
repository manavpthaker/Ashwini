export type StoryMomentId = "declare" | "blocked" | "early" | "decision";

export interface StoryMoment {
  id: StoryMomentId;
  day: number;
  date: string;
  status: "Tracking" | "Unusable" | "Early signal" | "Personally useful";
  heading: string;
  body: string;
  evidence: string;
  next: string;
  refused: string;
}

export interface DemoSession {
  day: number;
  date: string;
  routine: "followed" | "not followed";
  outcome: "met" | "adjusted" | "blocked";
  note: string;
  confound?: string;
}

export const storyMoments: readonly StoryMoment[] = [
  {
    id: "declare",
    day: 1,
    date: "May 4",
    status: "Tracking",
    heading: "Will one familiar meal make afternoon training more reliable?",
    body: "For 30 days, compare a known pre-training meal 60–90 minutes before afternoon sessions against similar sessions when the routine is not followed.",
    evidence: "No result exists yet. The question, target, comparison, confounds, and review date are declared before the first session.",
    next: "Repeat the routine when practical. Record only whether it happened and whether the planned session was completed.",
    refused: "Ashwini will not infer a benefit from intention, a single workout, or a nutrition estimate.",
  },
  {
    id: "blocked",
    day: 9,
    date: "May 12",
    status: "Unusable",
    heading: "No verdict from today’s session.",
    body: "The meal routine was followed, but severe sleep debt made this workout unlike the clean comparison sessions.",
    evidence: "This session remains in the record and is excluded from the result. It cannot count for or against the routine.",
    next: "Recover normally. Continue the comparison only when the next session is comparable.",
    refused: "Ashwini will not blame the meal, credit the meal, or interpret the poor session as a recovery diagnosis.",
  },
  {
    id: "early",
    day: 19,
    date: "May 22",
    status: "Early signal",
    heading: "The routine sessions look more reliable. It is still too early to keep the routine.",
    body: "Four of four clean sessions with the routine met the completion target. One of three clean sessions without it did.",
    evidence: "The direction is worth retaining, but seven comparable sessions are not enough for the pre-declared review.",
    next: "Continue through Day 30. Do not add another nutrition or training intervention.",
    refused: "Ashwini will not say the meal worked, caused the difference, or applies outside afternoon sessions.",
  },
  {
    id: "decision",
    day: 30,
    date: "June 2",
    status: "Personally useful",
    heading: "Keep the pre-training meal routine for afternoon sessions?",
    body: "Across ten comparable sessions, the planned work was completed in five of six sessions with the routine and one of four sessions without it.",
    evidence: "Two additional sessions were excluded before calculation. The pattern supports a narrow practical choice, not a biological explanation.",
    next: "Choose whether to keep, repeat, or retire the routine for the next training block.",
    refused: "Ashwini will not claim causality, generalize to morning sessions, or prescribe calories, macros, or medication changes.",
  },
] as const;

export const demoSessions: readonly DemoSession[] = [
  { day: 2, date: "May 5", routine: "followed", outcome: "met", note: "Planned work completed" },
  { day: 4, date: "May 7", routine: "not followed", outcome: "adjusted", note: "Volume reduced" },
  { day: 7, date: "May 10", routine: "followed", outcome: "met", note: "Planned work completed" },
  { day: 9, date: "May 12", routine: "followed", outcome: "blocked", note: "Excluded before review", confound: "Severe sleep debt" },
  { day: 11, date: "May 14", routine: "not followed", outcome: "adjusted", note: "Session stopped early" },
  { day: 14, date: "May 17", routine: "followed", outcome: "met", note: "Planned work completed" },
  { day: 16, date: "May 19", routine: "not followed", outcome: "met", note: "Planned work completed" },
  { day: 18, date: "May 21", routine: "followed", outcome: "met", note: "Planned work completed" },
  { day: 21, date: "May 24", routine: "not followed", outcome: "adjusted", note: "Volume reduced" },
  { day: 23, date: "May 26", routine: "followed", outcome: "adjusted", note: "Volume reduced" },
  { day: 26, date: "May 29", routine: "not followed", outcome: "blocked", note: "Excluded before review", confound: "Travel and adherence gap" },
  { day: 29, date: "June 1", routine: "followed", outcome: "met", note: "Planned work completed" },
] as const;

export const comparisonRows = [
  { condition: "Routine followed", comparable: 6, targetMet: 5, language: "More reliable in this window" },
  { condition: "Routine not followed", comparable: 4, targetMet: 1, language: "Comparison condition" },
  { condition: "Confounded", comparable: 0, targetMet: 0, language: "2 sessions excluded" },
] as const;

export const sourcePlan = [
  { name: "Planned session", owner: "Training plan", burden: "Automatic after integration", state: "Not connected" },
  { name: "Meal routine", owner: "One user confirmation", burden: "One tap on training days", state: "Demo interaction" },
  { name: "Session completion", owner: "Training log or user", burden: "One tap if not imported", state: "Demo interaction" },
  { name: "Sleep window", owner: "Apple Health or WHOOP", burden: "No daily entry", state: "Not connected" },
  { name: "Travel or illness", owner: "User exception", burden: "Only when unusual", state: "Not connected" },
  { name: "Medication adherence", owner: "Protected record", burden: "Separate from the test", state: "Not interpreted" },
] as const;

export const evidenceLadder = [
  { status: "Tracking", meaning: "The question and routine are declared; no result exists.", day: 1 },
  { status: "Unusable", meaning: "A contaminated session is retained but cannot influence the verdict.", day: 9 },
  { status: "Early signal", meaning: "A direction is visible; the declared review is not complete.", day: 19 },
  { status: "Personally useful", meaning: "Repeated clean comparisons support a narrow routine choice.", day: 30 },
] as const;
