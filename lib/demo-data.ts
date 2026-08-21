export type EvidenceStatus =
  | "Recorded"
  | "Unusable"
  | "Rule-based"
  | "Noticed"
  | "Tracking"
  | "Early signal"
  | "Consistent pattern"
  | "Personally useful"
  | "Route out";

export type GateStatus = "Clear" | "Caveated" | "Blocked";

export type DomainId = "training" | "nutrition" | "body" | "focus" | "medication";

export interface DecisionItem {
  id: string;
  domain: string;
  status: EvidenceStatus;
  gate: GateStatus;
  title: string;
  summary: string;
  whyNow: string;
  evidence: string;
  refused: string;
  choices: readonly string[];
  expiry: string;
}

export interface QuietItem {
  status: EvidenceStatus;
  domain: string;
  title: string;
  summary: string;
}

export interface Routine {
  id: string;
  domain: string;
  title: string;
  status: EvidenceStatus;
  progress: string;
  behavior: string;
  target: string;
  review: string;
  evidence: string;
  confounds: string;
  stop: string;
}

export interface DomainReview {
  id: DomainId;
  label: string;
  status: EvidenceStatus;
  gate: GateStatus;
  eyebrow: string;
  title: string;
  summary: string;
  allowed: string;
  refused: string;
  window: string;
  metrics: readonly { label: string; value: string; note: string }[];
  timeline: readonly { date: string; label: string; detail: string; state: "clear" | "caveated" | "blocked" }[];
}

export interface SourceRecord {
  name: string;
  kind: string;
  owner: string;
  freshness: string;
  state: "Available" | "Needs review" | "Protected" | "Excluded";
  note: string;
}

export interface MonthDay {
  date: string;
  day: number;
  weekday: string;
  state: "quiet" | "recorded" | "routine" | "blocked" | "today";
  records: number;
}

export interface TodayScheduleItem {
  time: string;
  domain: string;
  title: string;
  detail: string;
  state: "done" | "open" | "scheduled";
}

export interface AdvisorMessage {
  id: string;
  role: "user" | "ashwini";
  time: string;
  text: string;
  receipt?: string;
  kind?: "record" | "recommendation" | "question" | "route";
}

export interface MiddayPriority {
  id: string;
  time: string;
  domain: string;
  title: string;
  detail: string;
  action: string;
  state: "now" | "next" | "later";
}

export interface EvidenceConnector {
  name: string;
  status: string;
  scope: string;
  coverage: string;
  boundary: string;
  href: string;
}

export const evidenceDefinitions: readonly { status: EvidenceStatus; action: string; meaning: string }[] = [
  { status: "Recorded", action: "Store", meaning: "A source says this occurred. It is not yet an interpretation." },
  { status: "Unusable", action: "Block", meaning: "Quality or confounds prevent this window from supporting a verdict." },
  { status: "Rule-based", action: "Choose", meaning: "A pre-agreed rule applies to the current facts." },
  { status: "Noticed", action: "Retain", meaning: "A natural variation may be worth remembering, without a conclusion." },
  { status: "Tracking", action: "Repeat", meaning: "A single low-risk behavior is being deliberately repeated." },
  { status: "Early signal", action: "Continue", meaning: "A small pattern appears, but material uncertainty remains." },
  { status: "Consistent pattern", action: "Compare", meaning: "A relationship recurs across comparable clean windows." },
  { status: "Personally useful", action: "Keep", meaning: "Repeated personal evidence supports the bounded routine and target." },
  { status: "Route out", action: "Handoff", meaning: "The question belongs with a clinician, pharmacist, or dermatologist." },
] as const;

export const initialConversation: readonly AdvisorMessage[] = [
  {
    id: "msg-0736-user",
    role: "user",
    time: "7:36 AM",
    text: "Breakfast was two eggs, toast, and coffee. Slept 6 hours 18 minutes.",
    receipt: "Breakfast + sleep recorded",
    kind: "record",
  },
  {
    id: "msg-0737-ashwini",
    role: "ashwini",
    time: "7:37 AM",
    text: "I logged breakfast at roughly 24–30 g protein and marked sleep below your usual range. No morning change needed. I’ll use both when I make the training call this afternoon.",
    receipt: "Nutrition estimate · medium confidence",
    kind: "recommendation",
  },
  {
    id: "msg-0803-user",
    role: "user",
    time: "8:03 AM",
    text: "Prescription A taken. Supply count is 14.",
    receipt: "Protected adherence record",
    kind: "record",
  },
  {
    id: "msg-1012-user",
    role: "user",
    time: "10:12 AM",
    text: "Focus is 4 out of 5. Energy feels normal and the shoulder is quiet.",
    receipt: "Check-in + training context",
    kind: "record",
  },
  {
    id: "msg-1013-ashwini",
    role: "ashwini",
    time: "10:13 AM",
    text: "Good enough to keep the 4:30 session on the board. I’m holding the final volume call until 3:45 because sleep was short.",
    receipt: "Training plan retained · recheck scheduled",
    kind: "recommendation",
  },
  {
    id: "msg-1218-ashwini",
    role: "ashwini",
    time: "12:18 PM",
    text: "It’s midday and I still need lunch. You train in 4 hours 12 minutes. Send a photo or tell me what you ate; today I’d favor a familiar meal with 30–40 g protein and a normal carbohydrate portion.",
    receipt: "Missing input · lunch",
    kind: "question",
  },
] as const;

export const middayPriorities: readonly MiddayPriority[] = [
  {
    id: "lunch",
    time: "Now",
    domain: "Nutrition",
    title: "Log lunch before the afternoon disappears.",
    detail: "No meal is recorded after breakfast. Training starts in 4h 12m; a familiar 30–40 g protein meal is the best fit today.",
    action: "Tell Ashwini",
    state: "now",
  },
  {
    id: "training",
    time: "3:45 PM",
    domain: "Training",
    title: "Make the final volume call.",
    detail: "The session stays on. Short sleep makes full volume conditional on energy and shoulder status at the pre-session check.",
    action: "Recheck later",
    state: "next",
  },
  {
    id: "refill",
    time: "This week",
    domain: "Medication",
    title: "Start the refill request.",
    detail: "The confirmed supply is 14. That is enough runway, but waiting until next week adds avoidable risk.",
    action: "Open handoff",
    state: "later",
  },
] as const;

export const evidenceConnectors: readonly EvidenceConnector[] = [
  {
    name: "Examine Connect",
    status: "Adapter ready · authorization needed",
    scope: "Supplement–drug and supplement–supplement safety",
    coverage: "Returns graded interaction evidence, severity, notes, and PubMed references for a submitted regimen.",
    boundary: "Does not cover drug–drug interactions. Efficacy and dosing require a separate Examine license. No live query runs in this synthetic workspace.",
    href: "https://connect.examine.com/",
  },
  {
    name: "Personal record",
    status: "Available · 30-day synthetic history",
    scope: "Meals, routines, recovery, training, and follow-through",
    coverage: "Supports time-aware recommendations and bounded personal pattern comparisons.",
    boundary: "A personal association is not a diagnosis and does not override a safety source or specialist decision.",
    href: "#personal-record",
  },
] as const;

export const todayDecisions: readonly DecisionItem[] = [
  {
    id: "training-volume",
    domain: "Training · recovery",
    status: "Rule-based",
    gate: "Clear",
    title: "A high-volume session is scheduled after three low-recovery days.",
    summary: "Your pre-agreed recovery rule is active. Choose what happens to today’s plan; Ashwini does not choose for you.",
    whyNow: "The session starts at 4:30 PM. Sleep and recovery inputs are complete enough to apply rule v0.2.",
    evidence: "3 low-recovery days · planned volume 18 sets · no illness, travel, alcohol, or medication change recorded",
    refused: "Ashwini cannot diagnose under-recovery, injury risk, or a medical reason for these measurements.",
    choices: ["Keep the plan", "Cut volume by the agreed rule", "Swap to mobility", "Do nothing"],
    expiry: "Expires when the session begins · review at the next weekly training summary",
  },
  {
    id: "refill-confirmation",
    domain: "Medication · protected record",
    status: "Recorded",
    gate: "Clear",
    title: "Confirm the supply count for Prescription A.",
    summary: "The last confirmed count reaches the reminder threshold in twelve days. This is a record-quality task, not medication advice.",
    whyNow: "The supply field has not been confirmed since June 8. A refill reminder should depend on a current count.",
    evidence: "27 of 28 scheduled events recorded · last confirmed supply: 26 units · pharmacy details on file",
    refused: "No interaction check, dose or timing suggestion, effectiveness claim, or prescriber-controlled change.",
    choices: ["Confirm supply", "Remind me tomorrow", "Open pharmacy details", "Do nothing"],
    expiry: "Remains open until supply is confirmed or the reminder is dismissed",
  },
] as const;

export const quietItems: readonly QuietItem[] = [
  {
    status: "Recorded",
    domain: "Recovery",
    title: "HRV is 12% below its 21-day median.",
    summary: "Stored as context. On its own, it does not change an action.",
  },
  {
    status: "Unusable",
    domain: "Body capture",
    title: "This week’s side view is misaligned.",
    summary: "Visible in the record and excluded from the 28-day comparison.",
  },
  {
    status: "Early signal",
    domain: "Nutrition",
    title: "The familiar pre-training meal is repeating well.",
    summary: "Five of six comparable sessions met the target. Keep tracking; no causal claim.",
  },
  {
    status: "Route out",
    domain: "Skin documentation",
    title: "Pigmented spot saved for dermatologist handoff.",
    summary: "Ashwini stores the dated image and context. It does not inspect or classify the spot.",
  },
] as const;

export const routines: readonly Routine[] = [
  {
    id: "pre-training-meal",
    domain: "Nutrition + training",
    title: "Familiar meal before afternoon training",
    status: "Early signal",
    progress: "Day 24 · review in 6 days",
    behavior: "Use House Dal v1 or the named fallback 60–90 minutes before an afternoon session.",
    target: "Complete the planned session without an unplanned reduction.",
    review: "June 30 · minimum 10 comparable sessions",
    evidence: "5 of 6 target met with the routine · 1 of 4 without · 2 blocked windows retained",
    confounds: "Sleep debt, travel, illness, alcohol, unusual schedule, adherence gaps, multiple interventions.",
    stop: "Stop for GI symptoms or if the routine conflicts with professional guidance.",
  },
  {
    id: "caffeine-cutoff",
    domain: "Focus + sleep context",
    title: "No caffeine after 2 PM",
    status: "Tracking",
    progress: "Day 5 · blind collection",
    behavior: "Keep the existing morning routine; record only whether caffeine occurred after 2 PM.",
    target: "Next-day focus response during the 10 AM prompt.",
    review: "July 12 · after 14 eligible days",
    evidence: "Six natural-variation windows were noticed before the routine began.",
    confounds: "Short sleep, alcohol, travel, illness, missed prompt, unusually late work.",
    stop: "No late-night interpretations. Pause if prompts become burdensome.",
  },
  {
    id: "post-lunch-walk",
    domain: "Movement + focus",
    title: "Ten-minute post-lunch walk",
    status: "Noticed",
    progress: "Candidate · not started",
    behavior: "Repeat one safe, familiar ten-minute walk after lunch on eligible workdays.",
    target: "Self-rated 3 PM alertness; expected lag is same-day.",
    review: "Choose a start date or leave as a retained observation",
    evidence: "Three naturally occurring walks aligned with higher responses. Too little and too confounded to interpret.",
    confounds: "Meal composition, meeting load, sleep, outdoor conditions, caffeine.",
    stop: "Do not start if walking is not currently safe or appropriate.",
  },
] as const;

export const reviews: readonly DomainReview[] = [
  {
    id: "training",
    label: "Training",
    status: "Rule-based",
    gate: "Clear",
    eyebrow: "Weekly progression call",
    title: "Keep the plan, but today’s volume rule is active.",
    summary: "The last seven days support continuing the current plan. Today is handled separately by the pre-agreed low-recovery rule.",
    allowed: "Three planned sessions were completed this week; apply the agreed volume rule today.",
    refused: "Low HRV caused poor recovery or proves injury risk.",
    window: "June 17–23 · rule v0.2",
    metrics: [
      { label: "Planned", value: "3", note: "sessions" },
      { label: "Completed", value: "3", note: "one adjusted" },
      { label: "Progression", value: "+2", note: "reps, same load" },
      { label: "Gate", value: "Clear", note: "today uses rule" },
    ],
    timeline: [
      { date: "Jun 17", label: "Upper body", detail: "Completed as planned", state: "clear" },
      { date: "Jun 19", label: "Lower body", detail: "Two reps added at the same load", state: "clear" },
      { date: "Jun 21", label: "Full body", detail: "Volume reduced under rule v0.2", state: "caveated" },
      { date: "Jun 23", label: "Today", detail: "High-volume plan; decision open", state: "clear" },
    ],
  },
  {
    id: "nutrition",
    label: "Nutrition",
    status: "Early signal",
    gate: "Caveated",
    eyebrow: "30-day routine window",
    title: "The familiar pre-training meal is more reliable so far.",
    summary: "The comparison is useful enough to continue, not strong enough for a causal claim. Photo estimates remain ranges.",
    allowed: "Comparable sessions with the routine have more often met the defined completion target so far.",
    refused: "House Dal v1 improves performance or contains an exact calorie amount.",
    window: "May 25–June 23 · review June 30",
    metrics: [
      { label: "With routine", value: "5/6", note: "target met" },
      { label: "Without", value: "1/4", note: "target met" },
      { label: "Excluded", value: "2", note: "kept visible" },
      { label: "Meal range", value: "520–720", note: "estimated kcal" },
    ],
    timeline: [
      { date: "May 29", label: "House Dal v1", detail: "Target met · comparable", state: "clear" },
      { date: "Jun 4", label: "No pre-training meal", detail: "Session adjusted · comparable", state: "clear" },
      { date: "Jun 9", label: "House Dal v1", detail: "Blocked by severe sleep debt", state: "blocked" },
      { date: "Jun 20", label: "House Dal v1", detail: "Target met · comparable", state: "clear" },
    ],
  },
  {
    id: "body",
    label: "Body",
    status: "Consistent pattern",
    gate: "Caveated",
    eyebrow: "Slow-system review",
    title: "Three standardized views move with the declared goal.",
    summary: "The visible silhouette, smoothed weight, and waist record move in the same direction. One misaligned image is excluded.",
    allowed: "Across three usable captures over 28 days, visible change is consistent with the declared aesthetic goal.",
    refused: "Exact body-fat change, exact muscle gain or loss, internal health, or that one body is objectively better.",
    window: "May 26–June 23 · protocol visual-0.1",
    metrics: [
      { label: "Captured", value: "4", note: "weekly sets" },
      { label: "Usable", value: "3", note: "one excluded" },
      { label: "Weight trend", value: "−1.6", note: "lb smoothed" },
      { label: "Waist trend", value: "−0.4", note: "in recorded" },
    ],
    timeline: [
      { date: "May 26", label: "Baseline", detail: "Front + side aligned", state: "clear" },
      { date: "Jun 2", label: "Week 1", detail: "Lighting outside protocol", state: "caveated" },
      { date: "Jun 9", label: "Week 2", detail: "Front + side aligned", state: "clear" },
      { date: "Jun 23", label: "Week 4", detail: "Side view misaligned and excluded", state: "blocked" },
    ],
  },
  {
    id: "focus",
    label: "Mood + focus",
    status: "Noticed",
    gate: "Caveated",
    eyebrow: "Behavioral context",
    title: "Late caffeine and lower next-day focus recur together.",
    summary: "This is an association across six eligible windows. The next step is a small routine, not an explanation.",
    allowed: "The pairing has recurred often enough to justify tracking a 2 PM cutoff.",
    refused: "Caffeine caused poor focus, or any psychological or psychiatric interpretation.",
    window: "May 15–June 18 · six eligible prompts",
    metrics: [
      { label: "Eligible", value: "6", note: "clean windows" },
      { label: "Late caffeine", value: "4", note: "recorded days" },
      { label: "Lower response", value: "3", note: "next morning" },
      { label: "Prompt burden", value: "8 sec", note: "median" },
    ],
    timeline: [
      { date: "May 15", label: "10 AM prompt", detail: "Lower focus after late caffeine", state: "clear" },
      { date: "May 28", label: "Prompt missed", detail: "Retained; cannot vote", state: "blocked" },
      { date: "Jun 7", label: "Travel day", detail: "Excluded before comparison", state: "blocked" },
      { date: "Jun 18", label: "10 AM prompt", detail: "Association recurred", state: "caveated" },
    ],
  },
  {
    id: "medication",
    label: "Medication",
    status: "Recorded",
    gate: "Clear",
    eyebrow: "Protected adherence record",
    title: "The record is complete enough for refill planning.",
    summary: "Medication lives in a protected lane. It may block another comparison, but it is never an experiment variable.",
    allowed: "Twenty-seven of twenty-eight scheduled events were recorded; confirm supply before calculating refill risk.",
    refused: "The prescription is effective, should change, interacts with something, or needs different timing.",
    window: "May 27–June 23 · identity masked in demo",
    metrics: [
      { label: "Scheduled", value: "28", note: "events" },
      { label: "Recorded", value: "27", note: "one gap" },
      { label: "Supply", value: "26", note: "last confirmed" },
      { label: "Advice", value: "None", note: "protected boundary" },
    ],
    timeline: [
      { date: "Jun 4", label: "Scheduled event", detail: "Recorded as taken", state: "clear" },
      { date: "Jun 8", label: "Supply count", detail: "26 units confirmed", state: "clear" },
      { date: "Jun 12", label: "Adherence gap", detail: "Recorded; reason not inferred", state: "caveated" },
      { date: "Jun 23", label: "Refill record", detail: "Supply confirmation requested", state: "clear" },
    ],
  },
] as const;

export const sources: readonly SourceRecord[] = [
  { name: "WHOOP", kind: "Recovery context", owner: "Planned import", freshness: "Today · 7:12 AM", state: "Needs review", note: "Synthetic stream. Device fields and failure behavior are not verified." },
  { name: "Apple Health", kind: "Sleep + activity", owner: "iPhone capture", freshness: "Today · 7:14 AM", state: "Needs review", note: "Synthetic stream. Permissions and canonical-field rules remain open." },
  { name: "Training log", kind: "Plan + outcomes", owner: "User confirmed", freshness: "Jun 21 · 6:02 PM", state: "Available", note: "Dummy plan and outcomes used by the training review." },
  { name: "Meal photos", kind: "Images + estimates", owner: "iPhone capture", freshness: "Today · 12:41 PM", state: "Available", note: "Dummy image records. Ranges only; no real image inference is running." },
  { name: "Prescription A", kind: "Adherence + supply", owner: "Protected record", freshness: "Today · 8:03 AM", state: "Protected", note: "Identity masked. Never used for dose, timing, interaction, or effectiveness advice." },
  { name: "Body protocol", kind: "Standardized visuals", owner: "Private capture", freshness: "Today · 7:32 AM", state: "Available", note: "Abstract placeholders only. One misaligned set is retained and excluded." },
  { name: "Lab report", kind: "Document record", owner: "User upload", freshness: "Jun 10", state: "Protected", note: "Dummy document metadata only. Values may be stored but are not clinically interpreted here." },
  { name: "Examine Connect", kind: "Supplement interaction safety", owner: "API adapter · not authorized", freshness: "Not queried", state: "Needs review", note: "Integration-ready for supplement–drug and supplement–supplement checks. No API key, live result, efficacy, dosing, or drug–drug coverage is represented." },
  { name: "Therapy material", kind: "Sensitive context", owner: "Out of scope", freshness: "Never", state: "Excluded", note: "Permanently excluded as an inference source." },
] as const;

export const monthDays: readonly MonthDay[] = [
  { date: "May 25", day: 25, weekday: "Sun", state: "recorded", records: 2 },
  { date: "May 26", day: 26, weekday: "Mon", state: "routine", records: 4 },
  { date: "May 27", day: 27, weekday: "Tue", state: "recorded", records: 3 },
  { date: "May 28", day: 28, weekday: "Wed", state: "blocked", records: 2 },
  { date: "May 29", day: 29, weekday: "Thu", state: "routine", records: 5 },
  { date: "May 30", day: 30, weekday: "Fri", state: "recorded", records: 3 },
  { date: "May 31", day: 31, weekday: "Sat", state: "quiet", records: 1 },
  { date: "Jun 1", day: 1, weekday: "Sun", state: "quiet", records: 1 },
  { date: "Jun 2", day: 2, weekday: "Mon", state: "recorded", records: 4 },
  { date: "Jun 3", day: 3, weekday: "Tue", state: "recorded", records: 3 },
  { date: "Jun 4", day: 4, weekday: "Wed", state: "routine", records: 5 },
  { date: "Jun 5", day: 5, weekday: "Thu", state: "recorded", records: 3 },
  { date: "Jun 6", day: 6, weekday: "Fri", state: "recorded", records: 3 },
  { date: "Jun 7", day: 7, weekday: "Sat", state: "blocked", records: 2 },
  { date: "Jun 8", day: 8, weekday: "Sun", state: "quiet", records: 1 },
  { date: "Jun 9", day: 9, weekday: "Mon", state: "blocked", records: 4 },
  { date: "Jun 10", day: 10, weekday: "Tue", state: "recorded", records: 4 },
  { date: "Jun 11", day: 11, weekday: "Wed", state: "routine", records: 5 },
  { date: "Jun 12", day: 12, weekday: "Thu", state: "blocked", records: 3 },
  { date: "Jun 13", day: 13, weekday: "Fri", state: "recorded", records: 3 },
  { date: "Jun 14", day: 14, weekday: "Sat", state: "quiet", records: 1 },
  { date: "Jun 15", day: 15, weekday: "Sun", state: "recorded", records: 2 },
  { date: "Jun 16", day: 16, weekday: "Mon", state: "routine", records: 5 },
  { date: "Jun 17", day: 17, weekday: "Tue", state: "routine", records: 5 },
  { date: "Jun 18", day: 18, weekday: "Wed", state: "recorded", records: 4 },
  { date: "Jun 19", day: 19, weekday: "Thu", state: "routine", records: 5 },
  { date: "Jun 20", day: 20, weekday: "Fri", state: "routine", records: 5 },
  { date: "Jun 21", day: 21, weekday: "Sat", state: "recorded", records: 4 },
  { date: "Jun 22", day: 22, weekday: "Sun", state: "quiet", records: 1 },
  { date: "Jun 23", day: 23, weekday: "Mon", state: "today", records: 4 },
] as const;

export const todaySchedule: readonly TodayScheduleItem[] = [
  { time: "7:36 AM", domain: "Nutrition", title: "Eggs + toast", detail: "Breakfast range recorded", state: "done" },
  { time: "8:03 AM", domain: "Medication", title: "Prescription A", detail: "Taken · supply 14", state: "done" },
  { time: "10:12 AM", domain: "Focus", title: "Morning check-in", detail: "Focus 4 · mood neutral", state: "done" },
  { time: "12:18 PM", domain: "Nutrition", title: "Lunch is missing", detail: "Photo or plain-language input needed", state: "open" },
  { time: "4:30 PM", domain: "Training", title: "Upper-body session", detail: "Volume recheck scheduled for 3:45", state: "scheduled" },
] as const;

export const mealReference = {
  name: "House Dal v1",
  range: "520–720 kcal",
  protein: "24–34 g protein",
  confidence: "Medium confidence",
  visible: "Dal, rice, spinach, known bowl",
  unknown: "Oil or ghee, recipe proportions, anything outside the image",
  correction: "Was there extra oil/ghee, a different portion, or a separate protein addition?",
} as const;

export const systemQuestions = [
  "Encryption-at-rest and key-recovery design",
  "Backup, deletion, and retention policy",
  "Offline queue behavior and conflict resolution",
  "Model-provider disclosure and opt-in boundary",
  "Native iOS delivery for time-critical medication reminders",
] as const;
