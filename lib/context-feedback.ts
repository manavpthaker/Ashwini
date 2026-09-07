/** Local, deterministic feedback. No provider calls, diagnosis or fact extraction. */
import { classifySensitiveContent } from "@/domain/advisor/sensitive-content";
import { attributedHealthClauses, isOwnerHealthClause } from "@/domain/advisor/rule";
import type {
  AdvisorInput,
  AdvisorOutput,
  HealthHistoryEntry,
  SourceRef,
} from "@/domain/advisor/types";

export type FeedbackTopic = "labs" | "sleep" | "focus" | "nutrition" | "review" | null;

export function feedbackTopic(text: string): FeedbackTopic {
  if (
    /\b(labs?|laboratory|blood ?work|blood tests?|ferritin|cholesterol|a1c|haemoglobin|hemoglobin|thyroid|tsh)\b/i.test(
      text,
    )
  )
    return "labs";
  if (/\b(focus|attention|concentrat\w*|adhd)\b/i.test(text)) return "focus";
  if (/\b(sleep|slept|insomnia|bedtime|wind.down)\b/i.test(text)) return "sleep";
  if (
    /\b(nutrition|foods?|meals?|ate|eat|eating|breakfast|lunch|dinner|protein|diet)\b/i.test(text)
  )
    return "nutrition";
  if (
    /\b(history|context|overview|review|assessment|brief|know about me)\b|\bhow (?:am i doing|is my health)\b|\bwhat (?:should i (?:focus|work) on|do (?:my|the) records (?:show|suggest))\b/i.test(
      text,
    )
  )
    return "review";
  return null;
}

export interface FeedbackPlan {
  topic: Exclude<FeedbackTopic, null> | "recovery";
  understanding: string;
  nextStep: string;
  uncertainty: string;
  followUp: string | null;
  sources: SourceRef[];
  hypothesis?: boolean;
}

function recentSleepReport(input: AdvisorInput) {
  const capturedAt = (input.capturedAt ?? input.now).getTime();
  const latest = [...(input.context.recentCheckins ?? [])].sort(receiptOrder).find((item) => {
    const age = capturedAt - item.at.getTime();
    return age >= 0 && age <= 48 * 60 * 60 * 1000 && /\b(sleep|slept)\b/i.test(item.text);
  });
  // A later sleep report is the boundary. Never look through a correction,
  // contradiction, mixed example or protected report for an older useful match.
  if (
    !latest ||
    classifySensitiveContent(latest.text) ||
    /\b(example|hypothetical|suppose|imagine|correction|actually|slept (?:well|great)|not (?:poorly|badly)|good sleep)\b|\b(?:didn't|did not|haven't|have not) (?:sleep|slept) (?:poorly|badly)\b/i.test(
      latest.text,
    )
  )
    return undefined;
  const supported = attributedHealthClauses(latest.text.toLowerCase()).some(
    (clause) =>
      isOwnerHealthClause(clause) &&
      /\b(?:i slept (?:badly|poorly)|(?:i had )?(?:poor|bad|disrupted|short) sleep|(?:i )?(?:didn't|did not|couldn't|could not) sleep)\b/.test(
        clause.text,
      ) &&
      !/\b(?:not|never|no longer|if|might|may|would|used to|last (?:week|month|year))\b/.test(
        clause.text.replace(/\b(?:did|could) not sleep\b/g, "missing sleep"),
      ),
  );
  return supported ? latest : undefined;
}

type RecentCheckin = NonNullable<AdvisorInput["context"]["recentCheckins"]>[number];
function receiptOrder(a: RecentCheckin, b: RecentCheckin): number {
  return (
    (b.receivedAt ?? b.advisorAt ?? b.at).getTime() -
      (a.receivedAt ?? a.advisorAt ?? a.at).getTime() ||
    b.at.getTime() - a.at.getTime() ||
    b.id.localeCompare(a.id)
  );
}

function hasCurrentLowEnergy(input: AdvisorInput): boolean {
  if (/\b(example|hypothetical|suppose|imagine|correction)\b/i.test(input.utterance.text))
    return false;
  return attributedHealthClauses(input.utterance.text.toLowerCase()).some(
    (clause) =>
      isOwnerHealthClause(clause) &&
      /\b(tired|exhausted|fatigued?|sleepy|drained|low energy|no energy|sluggish)\b/.test(
        clause.text,
      ) &&
      !/\b(no|not|never|without|if|might|may|would|used to|felt|was|yesterday|tomorrow|ago|last (?:week|month|year))\b/.test(
        clause.text.replace(/\bno energy\b/g, "low energy"),
      ),
  );
}

function measurementLabel(entry: HealthHistoryEntry): string {
  const match = entry.statement.match(
    /^(?:Historical clinical observation|Unconfirmed clinical observation record):\s*([^:]+?)(?:\s*\[|:)/,
  );
  return match?.[1]?.trim() ?? "recorded measurement";
}

/** Content changes with supplied evidence; general advice stays explicitly rule-based. */
export function contextFeedbackPlan(
  input: AdvisorInput,
  baseline: AdvisorOutput,
  history: readonly HealthHistoryEntry[],
): FeedbackPlan | null {
  // Never overwrite a safety outcome, interaction block, protected dose record,
  // existing practical timing rule or unreadable comparison window.
  if (
    baseline.route ||
    !["fallback", "nutrition", "training-volume"].includes(baseline.trace.ruleId) ||
    baseline.decisions.some((decision) => decision.gateOutcome === "blocked")
  )
    return null;

  const sleepReport =
    baseline.trace.ruleId === "training-volume" && hasCurrentLowEnergy(input)
      ? recentSleepReport(input)
      : undefined;
  if (sleepReport)
    return {
      topic: "recovery",
      understanding: `Your sleep check-in from ${sleepReport.at.toISOString().slice(0, 10)} and this low-energy report support treating recovery as a possible constraint. Sleep may be contributing; workload or an unmeasured factor could also explain it.`,
      nextStep:
        "Reduce an optional demand for this check-in's recovery window and reassess how you feel after ordinary rest; this is not clearance to exercise through symptoms.",
      uncertainty:
        "Two self-reports support a working hypothesis, not a diagnosis, a current wearable finding or a demonstrated personal pattern. New, persistent or worsening symptoms need clinical evaluation.",
      followUp: "How much sleep did you get before this low-energy check-in?",
      sources: [{ table: "messages", id: sleepReport.id }],
      hypothesis: true,
    };
  if (baseline.trace.ruleId === "training-volume") return null;

  const topic = feedbackTopic(input.utterance.text);
  if (!topic) return null;
  const sources: SourceRef[] = [];
  const common = { topic, sources };
  if (topic === "labs") {
    const measurements = history.filter((entry) => entry.category === "measurement");
    const flagged = measurements.filter((entry) =>
      /Source interpretation:\s*(?:high|low|abnormal|critical)\b/i.test(entry.statement),
    );
    const chosen = (flagged.length ? flagged : measurements).slice(0, 2);
    sources.push(...chosen.map((entry) => ({ table: "health_context_entries", id: entry.id })));
    return {
      ...common,
      understanding: measurements.length
        ? `The selected record includes ${measurements.length} dated or date-unknown measurement assertions${flagged.length ? `; ${flagged.length} carry a high, low, abnormal or critical label supplied by the source record` : "; I have not independently classified any as normal or abnormal"}. ${chosen.length ? `The first review items are ${[...new Set(chosen.map(measurementLabel))].join(" and ")}.` : ""}`
        : "I do not have a relevant laboratory result in the selected context, so I cannot tell you what your labs show.",
      nextStep: flagged.length
        ? "Review the source-flagged result, its date and reference range with the ordering clinician, including whether it was already addressed; do not start treatment from an old flag."
        : measurements.length
          ? "Start with the newest complete panel and its own reference ranges; review changes with the ordering clinician before making a treatment or supplement decision."
          : "Add the dated result with its units and the laboratory's reference range; that makes the next check-in about the result instead of another general intake.",
      uncertainty:
        "A historical value or source flag is not a current diagnosis. This rules-based review does not establish a deficiency, medication effect or treatment need.",
      followUp: measurements.length
        ? "Were these results already reviewed or followed up by the ordering clinician?"
        : null,
    };
  }
  if (topic === "focus") {
    const barrier = input.utterance.text
      .match(/focus barrier:\s*(starting|staying|mental energy)/i)?.[1]
      ?.toLowerCase();
    return {
      ...common,
      understanding: barrier
        ? `The difficulty you identified is ${barrier === "starting" ? "getting started" : barrier === "staying" ? "staying with the task" : "mental energy"}. That narrows the next step without assuming a diagnosis or a medication effect.`
        : history.some((entry) => /\b(focus|attention|adhd|concentrat\w*)\b/i.test(entry.statement))
          ? "There is attention-related history in the saved record. That makes your existing supports relevant, but it does not establish why focus is difficult in this check-in."
          : "The record does not establish a measured focus pattern. A small change to the work setup is still a useful starting point; a cause does not need to be guessed first.",
      nextStep:
        barrier === "starting"
          ? "Make the first action small enough to do in two minutes, open only what it needs and try that start once. Note whether the smaller start helped; keep prescribed treatment unchanged."
          : barrier === "staying"
            ? "Try one 15-minute single-task block with optional notifications silenced and a place to park distracting thoughts. Note when attention drifted; keep prescribed treatment unchanged."
            : barrier === "mental energy"
              ? "Take an ordinary break before the next optional work block and note whether alertness changes. Do not change medication or treat this as proof of a cause; persistent or worsening fatigue deserves clinical review."
              : "For one 15-minute block, write one concrete task, silence optional notifications and note whether you started and stayed with it. Keep prescribed treatment unchanged.",
      uncertainty:
        "This is a reversible work-setup suggestion, not an ADHD assessment or a claim that sleep, medication or motivation caused the difficulty.",
      followUp: barrier
        ? null
        : "Is the main difficulty getting started, staying with the task, or feeling mentally tired?",
    };
  }
  if (topic === "sleep") {
    const hasSleep =
      history.some((entry) => entry.category === "sleep") ||
      (input.context.healthObservationCoverage ?? []).some(
        (entry) => /sleep/i.test(entry.type) && entry.latestEndAt,
      ) ||
      (input.context.healthSummaries ?? []).some((entry) => /sleep/i.test(entry.type)) ||
      (input.context.healthObservations ?? []).some((entry) => /sleep/i.test(entry.type));
    return {
      ...common,
      understanding: hasSleep
        ? "There is sleep context to build on, but a saved plan and a dated wearable record answer different questions: what was intended versus what was recorded. Neither alone establishes last night's sleep or why it felt poor."
        : "There is no usable sleep measurement in this selected context. Your check-in can still guide a simple routine without pretending we have a wearable baseline.",
      nextStep: history.some(
        (entry) => entry.category === "sleep" && /wind.down|bedtime|routine/i.test(entry.statement),
      )
        ? "Use a familiar, non-medication wind-down routine for one evening, and record bedtime, wake time and whether you felt rested; do not assume the older plan is still active."
        : "Choose one repeatable, non-medication wind-down step for one evening, and record bedtime, wake time and whether you felt rested.",
      uncertainty:
        "This is a low-risk routine suggestion, not a sleep-disorder diagnosis or a proven effect. Persistent sleep difficulty belongs in a clinician review.",
      followUp:
        "For the night you want help with, what were your approximate bedtime and wake time?",
    };
  }
  if (topic === "nutrition") {
    const actualMeal = baseline.records.find((record) => record.kind === "meal");
    const hasNutrition = history.some(
      (entry) =>
        ["nutrition", "goal", "preference"].includes(entry.category) &&
        /\b(food|meal|protein|diet|nutrition|vegetarian|vegan)\b/i.test(entry.statement),
    );
    const mealChoice = input.utterance.text
      .match(/nutrition priority:\s*(breakfast|lunch|dinner|snack) consistency/i)?.[1]
      ?.toLowerCase();
    return {
      ...common,
      understanding: mealChoice
        ? `You identified ${mealChoice} as the meal that is hard to make consistent. That is a practical planning target, not a conclusion about calories or diet quality.`
        : actualMeal
          ? "This check-in adds a real meal to the record. It does not by itself establish the day's intake, adequacy or a calorie/protein total."
          : hasNutrition
            ? "Your saved nutrition goals and preferences can guide meal planning, but older targets are not automatically today's prescription or intake."
            : "There is not enough current intake information to judge your overall diet. A repeatable meal habit is more useful than inventing precise targets from this record.",
      nextStep: mealChoice
        ? `Choose one familiar fallback for ${mealChoice} and make its ingredients or ordering choice easy to access before that meal. Keep existing clinician-directed restrictions in control; no new calorie or nutrient target is needed for this step.`
        : "Choose one familiar meal you can repeat, within any existing clinician-directed restrictions, and note its foods plus a rough household portion. Use the record to make the next meal decision, not to judge the whole day.",
      uncertainty:
        "No calorie deficit, personalized protein target, allergy clearance or medical nutrition change is inferred.",
      followUp: mealChoice
        ? null
        : actualMeal?.kind === "meal" && !actualMeal.description
          ? "What foods made up that meal?"
          : "Which upcoming meal is hardest to make consistent?",
    };
  }
  const total = input.context.healthHistory?.length ?? 0;
  const medications = (input.context.healthHistory ?? []).filter(
    (entry) => entry.category === "medication_history" && entry.confirmationRequired,
  ).length;
  const routines = input.context.activeRoutines.length;
  const priority = input.utterance.text
    .match(/review priority:\s*(energy|training)/i)?.[1]
    ?.toLowerCase();
  if (priority)
    return {
      ...common,
      understanding: `${priority === "energy" ? "Energy" : "Training"} is the priority you selected. The dated record can provide background, but it does not establish ${priority === "energy" ? "your current alertness or why it changes" : "your current training routine or readiness"}.`,
      nextStep:
        priority === "energy"
          ? "Record your energy and the time once before changing several behaviors. Pair the next check-in with the relevant sleep or meal timing so a possible contributor can be tested rather than assumed."
          : "Name the familiar training routine you actually follow and record the next session as it happened. Do not intensify or start a replacement program based on an old plan in the archive.",
      uncertainty:
        "This is a practical observation step, not a diagnosis, exercise clearance or a proven personal pattern.",
      followUp:
        priority === "energy"
          ? "Is the energy change new for you, or your usual pattern?"
          : "What training are you actually doing now?",
    };
  return {
    ...common,
    understanding: total
      ? `Your record contains ${total} source assertions, but that is not the same as a current health assessment. ${routines ? `${routines} active routine${routines === 1 ? " is" : "s are"} confirmed in the app.` : "No active routine is confirmed in the app yet."}${medications ? " Historical medication orders still need reconciliation; they are not your current medication list." : ""}`
      : "There is no imported health history available in this context yet. We can still start with one current priority and build a dated record around it.",
    nextStep: routines
      ? "Keep one familiar low-risk routine steady and record one relevant outcome at your next check-in; do not change multiple behaviors based on this snapshot."
      : "Pick one current priority and one familiar low-risk routine you actually follow. Confirming that starting point will make the next check-in more useful than adding another historical plan.",
    uncertainty:
      "This is a source-and-readiness review, not a diagnosis, a full chart assessment or a claim that historical records are current.",
    followUp: "Which priority should guide the next step: sleep, energy, focus, food or training?",
  };
}

export interface CheckinContinuation {
  kind: "pre_training_timing" | "focus_barrier" | "review_priority" | "nutrition_meal";
  priorUserMessageId: string;
  priorAdvisorMessageId: string | null;
  previousQuestion: string;
  /** A narrow safe reconstruction, never the old user report/symptoms. */
  reasoningText: string;
}

/** Only continue a known unanswered question from the immediately prior check-in. */
export function resolveCheckinContinuation(input: AdvisorInput): CheckinContinuation | null {
  const text = input.utterance.text.trim();
  const barrier = input.context.latestReceiptTurn;
  const previous = barrier
    ? input.context.recentCheckins?.find((item) => item.id === barrier.id)
    : [...(input.context.recentCheckins ?? [])].sort(receiptOrder)[0];
  if (barrier !== undefined && (!barrier || !barrier.eligible || barrier.id !== previous?.id))
    return null;
  if (!previous || classifySensitiveContent(previous.text) || !previous.advisorReply) return null;
  const eventTime = (input.capturedAt ?? input.now).getTime();
  const age = eventTime - previous.at.getTime();
  // Delayed captures cannot answer a question the app had not yet asked.
  if (
    age < 0 ||
    age > 6 * 60 * 60 * 1000 ||
    (previous.advisorAt && previous.advisorAt.getTime() > eventTime)
  )
    return null;
  const target = {
    priorUserMessageId: previous.id,
    priorAdvisorMessageId: previous.advisorMessageId ?? null,
  };
  if (
    /Is the main difficulty getting started, staying with the task, or feeling mentally tired\?/i.test(
      previous.advisorReply,
    )
  ) {
    const barrier = /^(?:getting )?start(?:ed|ing)?[.!]?$/i.test(text)
      ? "starting"
      : /^(?:staying(?: with (?:the )?task)?|staying focused)[.!]?$/i.test(text)
        ? "staying"
        : /^(?:feeling )?mentally tired[.!]?$/i.test(text)
          ? "mental energy"
          : null;
    if (barrier)
      return {
        ...target,
        kind: "focus_barrier",
        previousQuestion:
          "Is the main difficulty getting started, staying with the task, or feeling mentally tired?",
        reasoningText: `Help improve my focus. Focus barrier: ${barrier}.`,
      };
  }
  if (
    /Which priority should guide the next step: sleep, energy, focus, food or training\?/i.test(
      previous.advisorReply,
    )
  ) {
    const selected = text.toLowerCase().replace(/[.!]$/, "");
    const priorities: Record<string, string> = {
      sleep: "Review my sleep context",
      focus: "Help improve my focus",
      food: "Review my nutrition context",
      nutrition: "Review my nutrition context",
      energy: "Review priority: energy",
      training: "Review priority: training",
    };
    if (priorities[selected])
      return {
        ...target,
        kind: "review_priority",
        previousQuestion:
          "Which priority should guide the next step: sleep, energy, focus, food or training?",
        reasoningText: priorities[selected],
      };
  }
  if (
    /Which upcoming meal is hardest to make consistent\?/i.test(previous.advisorReply) &&
    /^(?:breakfast|lunch|dinner|snack)[.!]?$/i.test(text)
  ) {
    return {
      ...target,
      kind: "nutrition_meal",
      previousQuestion: "Which upcoming meal is hardest to make consistent?",
      reasoningText: `Nutrition priority: ${text.replace(/[.!]$/, "")} consistency.`,
    };
  }
  if (
    !/How long until training starts\?/i.test(previous.advisorReply) ||
    !/^(?:(?:in|about|around)\s+)?(?:\d+(?:\.\d+)?|one|two|three|four|five|half(?: an?)?)\s*(?:minutes?|mins?|hours?|hrs?)[.!]?$|^(?:at|around)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)[.!]?$/i.test(
      text,
    )
  )
    return null;
  return {
    ...target,
    kind: "pre_training_timing",
    previousQuestion: "How long until training starts?",
    reasoningText: `What should I eat before training? — ${text}`,
  };
}
