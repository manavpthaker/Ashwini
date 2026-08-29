"use client";

import Link from "next/link";
import { useRef, useSyncExternalStore } from "react";
import { buttonClassName, Button, Eyebrow, Status } from "@/components/design-system/ui";
import { ArrowIcon, BowlIcon, CareIcon, ClockIcon, MedicationIcon, MoonIcon, MovementIcon, RuleIcon } from "@/components/product/icons";
import { useProduct } from "@/components/product/product-provider";
import { baseDayEvents, basePerspectives } from "@/lib/product-data";
import type { AttentionState, DayEvent, PerspectiveContribution, PerspectiveTone, ScenarioPhase, TrainingChoice, TrainingGate } from "@/lib/product-model";
import { activeDecisionRecord, responseForActiveDecision } from "@/lib/synthetic-scenario";
import styles from "./today-screen.module.css";

const toneIcon = {
  nutrition: BowlIcon,
  recovery: MoonIcon,
  training: MovementIcon,
  medication: MedicationIcon,
  care: CareIcon,
} satisfies Record<PerspectiveTone, typeof BowlIcon>;

type MealStatus = ReturnType<typeof useProduct>["derivedDay"]["mealStatus"];
type ChoiceSource = ReturnType<typeof useProduct>["trainingChoiceSource"];

function currentRecommendation(
  mealStatus: MealStatus,
  trainingChoice: TrainingChoice,
  trainingGate: TrainingGate,
  attention: AttentionState,
  choiceSource: ChoiceSource,
) {
  if (attention === "urgent-care") {
    return {
      headline: "Stop here and seek urgent medical help now.",
      summary: "An urgent check-in is still open. Ashwini cannot assess or monitor an emergency, and a later routine check-in cannot clear this handoff.",
      status: "Route out",
      tone: "route" as const,
      recheck: "Urgent human care",
      knownNow: "Urgent check-in recorded · human-care handoff open · no monitoring",
      whatChanges: "Correcting the record if it is wrong; otherwise this belongs with immediate human care.",
      nextLabel: "Urgent care",
    };
  }

  if (attention === "medication-event") {
    return {
      headline: "Get medication-specific guidance now. Do not let the routine plan bury this.",
      summary: "A medication question is open that only a pharmacist or prescriber should answer. Ashwini retains your exact wording but will not determine medication safety or invent a corrective dose.",
      status: "Route out",
      tone: "route" as const,
      recheck: "Pharmacist or prescriber",
      knownNow: "Medication event recorded · qualified-human handoff open · no safety result",
      whatChanges: "Correcting the record if it is wrong, or guidance from the appropriate qualified human.",
      nextLabel: "Human guidance",
    };
  }

  if (trainingGate === "blocked") {
    return {
      headline: "Pause the loaded session. Put the next decision with the right human.",
      summary: "A symptom you reported blocked the training verdict. Ashwini retains the wording, but it will not turn symptom text into clearance or a diagnosis.",
      status: "Route out",
      tone: "route" as const,
      recheck: "Human guidance needed",
      knownNow: "Symptom recorded · training gate blocked · no loaded-training verdict",
      whatChanges: "Appropriate human judgment and an updated plan—not another check-in.",
      nextLabel: "Human guidance",
    };
  }

  if (choiceSource === "user") {
    if (trainingChoice === "pause") {
      return {
        headline: "Loaded training is paused by your choice.",
        summary: "This is a current-session plan selection, not a symptom inference or clinical route-out. Keep the plan paused unless you deliberately choose another available option.",
        status: "Recorded",
        tone: "training" as const,
        recheck: "User-owned choice",
        knownNow: `User selected pause · training gate ${trainingGate}`,
        whatChanges: "A different user selection, a later check-in, or a safety block.",
        nextLabel: "Next choice",
      };
    }

    if (trainingChoice === "full") {
      return {
        headline: "Full volume is selected for this session.",
        summary: "Nothing in your check-ins blocked the session and you selected the existing full-volume plan. This is a recorded user choice, not medical clearance.",
        status: "Recorded",
        tone: "training" as const,
        recheck: "Stop if facts change",
        knownNow: "No active block · full volume selected by user",
        whatChanges: "Low energy, pain, a new symptom, or a different user choice.",
        nextLabel: "Session",
      };
    }

    if (trainingChoice === "reduced") {
      return {
        headline: "Reduced volume is selected for this session.",
        summary: "You chose the lower-volume version of the existing plan. The session remains optional, and the selection does not imply medical clearance.",
        status: "Recorded",
        tone: "recovery" as const,
        recheck: "User-owned choice",
        knownNow: `Reduced volume selected · training gate ${trainingGate}`,
        whatChanges: "A new check-in, a different user selection, or a safety block.",
        nextLabel: "Session",
      };
    }

    return {
      headline: "You kept the training decision open.",
      summary: "The session remains on the calendar, but volume is not selected. Check in before making the next choice.",
      status: "Recorded",
      tone: "training" as const,
      recheck: "Decision still open",
      knownNow: `Hold selected · training gate ${trainingGate}`,
      whatChanges: "A later check-in or a different user selection.",
      nextLabel: "3:45 check-in",
    };
  }

  if (trainingGate === "caution") {
    return {
      headline: "Low energy changed the call. Favor the reduced-volume session.",
      summary: "A caveated gate on the training decision favours the lower-volume session. It remains optional; this is not medical clearance.",
      status: "Rule-based",
      tone: "recovery" as const,
      recheck: "Choose in Plan",
      knownNow: "Training gate caveated by your check-in · session optional",
      whatChanges: "A different user choice or a new check-in; symptoms still route out.",
      nextLabel: "Plan choice",
    };
  }

  if (trainingGate === "clear") {
    return {
      headline: "Nothing is blocking the session. Choose the one you want to run.",
      summary: "No check-in today blocked or caveated the training decision. Full, reduced, or pause are available in Plan; none is medical clearance.",
      status: "Rule-based",
      tone: "training" as const,
      recheck: "Choice available",
      knownNow: "No active symptom or block · training gate clear",
      whatChanges: "Low energy, pain, a new symptom, or a user-selected plan change.",
      nextLabel: "Plan choice",
    };
  }

  if (mealStatus === "recorded") {
    return {
      headline: "Lunch is covered. Make the training call at 3:45.",
      summary: "The meal is in the record. Check in again before the session and the training options open up.",
      status: "Recorded",
      tone: "nutrition" as const,
      recheck: "Recheck at 3:45",
      knownNow: "Meal recorded · training gate pending",
      whatChanges: "A later check-in or a correction to the meal record.",
      nextLabel: "3:45 check-in",
    };
  }

  if (mealStatus === "needs-detail") {
    return {
      headline: "Lunch happened. Add one detail, then leave the plan alone.",
      summary: "Ashwini recorded that lunch happened without inventing calories or protein. A short description is enough to finish the record.",
      status: "Recorded",
      tone: "nutrition" as const,
      recheck: "Meal detail needed",
      knownNow: "Lunch occurrence recorded · contents unknown · no nutrition estimate",
      whatChanges: "A meal description, a correction, or a later check-in.",
      nextLabel: "Meal detail",
    };
  }

  if (mealStatus === "skipped") {
    return {
      headline: "Lunch is still open. Keep the next step familiar.",
      summary: "Training is later and short sleep remains relevant. If eating normally is appropriate, choose a familiar meal; if something feels wrong, say that directly instead.",
      status: "Rule-based",
      tone: "warning" as const,
      recheck: "One follow-up needed",
      knownNow: "Lunch open · reason unknown · training gate pending",
      whatChanges: "A meal record, the reason eating is difficult, or a later check-in.",
      nextLabel: "Follow-up",
    };
  }

  return {
    headline: "Get lunch in now. Make the training call at 3:45.",
    summary: "Nothing you have recorded today blocks the session, so training stays on the calendar. Eat something familiar, then check in again before choosing volume.",
    status: "Rule-based",
    tone: "recovery" as const,
    recheck: "Recheck at 3:45",
    knownNow: "No check-in today has blocked the session · training gate pending",
    whatChanges: "A lunch record, a later check-in, a user plan choice, or a safety block.",
    nextLabel: "3:45 check-in",
  };
}

/**
 * The brief's clock.
 *
 * `null` until mounted, on purpose: the server renders in the configured zone
 * and the browser in the device's, so formatting a real time during hydration is
 * a mismatch waiting to happen. It was previously the string "Synthetic Friday ·
 * 12:18 PM", which never moved.
 */
const dayLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const clockLabel = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

function nowLabel(at: Date): string {
  return `${dayLabel.format(at)} · ${clockLabel.format(at)}`;
}

function briefLabel(at: Date | null): string {
  if (!at) return "Your brief";
  const hour = at.getHours();
  if (hour < 11) return "Your morning brief";
  if (hour < 15) return "Your midday brief";
  if (hour < 19) return "Your pre-session brief";
  return "Your evening brief";
}

function subscribeToMinute(onChange: () => void) {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
}

function useNow(): Date | null {
  // The snapshot is the minute number rather than a Date, so it stays
  // referentially stable between ticks; `null` on the server is what keeps the
  // markup identical on both sides of hydration.
  const minute = useSyncExternalStore(
    subscribeToMinute,
    () => Math.floor(Date.now() / 60_000),
    () => null,
  );
  return minute === null ? null : new Date(minute * 60_000);
}

function choicePerspective(choice: TrainingChoice): PerspectiveContribution {
  const copy = {
    hold: ["Choice retained", "The user kept the training decision open."],
    full: ["User selected", "The user selected the existing full-volume plan with no active block."],
    reduced: ["User selected", "The user selected the existing reduced-volume plan for this session."],
    pause: ["User selected", "The user paused loaded training without creating a symptom claim or clinical route-out."],
  } as const;

  return {
    role: "Training",
    tone: "training",
    state: copy[choice][0],
    summary: copy[choice][1],
    basis: "User plan selection.",
    origin: "ashwini_synthesis",
  };
}

function nextCommitmentLabel(
  mealStatus: MealStatus,
  trainingChoice: TrainingChoice,
  trainingGate: TrainingGate,
  attention: AttentionState,
  scenarioPhase: ScenarioPhase,
  choiceSource: ChoiceSource,
) {
  if (attention === "urgent-care") return "Immediate human care";
  if (attention === "medication-event") return "Medication guidance · now";
  if (trainingGate === "blocked") return "Human guidance · now";
  if (choiceSource === "user" && trainingChoice === "pause") return "Loaded training paused";
  if (choiceSource === "user" && trainingChoice === "hold") {
    return scenarioPhase === "pre-session" ? "Plan choice still open" : "Check-in · 3:45 PM";
  }
  if (choiceSource === "user" && (trainingChoice === "full" || trainingChoice === "reduced")) {
    return scenarioPhase === "pre-session" ? "Session · 4:30 PM" : "Check-in · 3:45 PM";
  }
  if (trainingGate === "clear" || trainingGate === "caution") return "Plan choice · now";
  if (mealStatus === "recorded") return "Check-in · 3:45 PM";
  if (mealStatus === "needs-detail") return "Meal detail · now";
  if (mealStatus === "skipped") return "Lunch follow-up · now";
  return "Lunch · now";
}

function dayEvents(
  mealStatus: MealStatus,
  trainingChoice: TrainingChoice,
  trainingGate: TrainingGate,
  attention: AttentionState,
  scenarioPhase: ScenarioPhase,
  choiceSource: ChoiceSource,
): readonly DayEvent[] {
  return baseDayEvents.map((event) => {
    if (attention === "medication-event" && event.title === "Morning dose noted") {
      return { ...event, time: "Now", title: "Medication guidance needed", detail: "Unexpected-dose event retained · qualified-human handoff open", state: "current" };
    }

    if (attention === "urgent-care" && event.title === "Energy and shoulder check") {
      return { ...event, time: "Now", domain: "Care navigation", title: "Urgent human-care handoff", detail: "Routine planning stopped", state: "current" };
    }

    if (attention === "medication-event" && event.title === "Energy and shoulder check") {
      return { ...event, domain: "Medication + training", detail: "Routine plan withheld · medication handoff open", state: scenarioPhase === "pre-session" ? "current" : "upcoming" };
    }

    if (attention !== "none" && event.title === "Upper-body session") {
      return { ...event, title: "Upper-body session withheld", detail: "Human handoff remains open", state: "withheld" };
    }

    if (event.title === "Upper-body session" && trainingGate === "blocked") {
      return { ...event, title: "Upper-body session withheld", detail: "Training gate blocked · human guidance needed", state: "withheld" };
    }

    if (event.title === "Upper-body session" && choiceSource === "user" && trainingChoice === "pause") {
      return { ...event, title: "Upper-body session paused", detail: "Paused by user choice in this session", state: "paused" };
    }

    if (event.title === "Lunch check-in") {
      if (mealStatus === "recorded") return { ...event, title: "Lunch recorded", detail: "In your record", state: "complete" };
      if (mealStatus === "needs-detail") return { ...event, title: "Lunch occurred", detail: "Meal detail still needed", state: "current" };
      if (mealStatus === "skipped") return { ...event, title: "Lunch still open", detail: "Reason not yet known", state: "current" };
    }

    if (event.title === "Energy and shoulder check") {
      if (trainingGate === "blocked") return { ...event, time: "Now", title: "Training gate blocked", detail: "Human guidance needed", state: "current" };
      if (choiceSource === "user") {
        const selectedDetail = {
          hold: "Training decision kept open by user choice",
          full: "Full volume selected by user · not medical clearance",
          reduced: "Reduced volume selected by user",
          pause: "Loaded training paused by user choice",
        }[trainingChoice];
        return {
          ...event,
          time: trainingGate === "caution" ? "Now" : event.time,
          title: trainingGate === "caution" ? "Energy and plan update" : event.title,
          detail: selectedDetail,
          state: trainingGate === "clear" || trainingGate === "caution" ? "current" : event.state,
        };
      }
      if (trainingGate === "caution") return { ...event, time: "Now", title: "Low-energy check", detail: "Caution rule active · reduced volume favored", state: "current" };
      if (trainingGate === "clear") return { ...event, detail: "Gate clear · plan choice available", state: "current" };
    }

    return event;
  });
}

function PerspectivePath({ items, nextLabel }: { items: readonly PerspectiveContribution[]; nextLabel: string }) {
  const visibleItems = items.slice(0, 3);
  const lineY = visibleItems.length === 1 ? [66] : visibleItems.length === 2 ? [40, 92] : [22, 66, 110];
  const roles = visibleItems.map((item) => item.role).join(", ");

  return (
    <div className={styles.consultationPath} aria-label={`${roles} perspectives converge into one recommendation`}>
      <div className={styles.pathCopy}>
        <span>Relevant perspectives</span>
        <strong>One plan for right now</strong>
      </div>
      <svg className={styles.pathGraphic} viewBox="0 0 720 132" role="img" aria-labelledby="path-title path-description">
        <title id="path-title">How the recommendation formed</title>
        <desc id="path-description">{roles} perspectives converge into the current recommendation and continue to {nextLabel}.</desc>
        {visibleItems.map((item, index) => (
          <g key={item.role}>
            <path className={styles[`${item.tone}Path`]} d={`M18 ${lineY[index]} C180 ${lineY[index]} 212 66 360 66 S510 66 700 66`} />
            <circle className={styles[`${item.tone}Dot`]} cx="18" cy={lineY[index]} r="7" />
          </g>
        ))}
        <circle className={styles.convergenceDot} cx="360" cy="66" r="13" />
        <circle className={styles.nextDot} cx="700" cy="66" r="8" />
      </svg>
      <div className={styles.pathLabels} aria-hidden="true">
        <div className={styles.pathDomains}>{visibleItems.map((item) => <span key={item.role}><i className={styles[`${item.tone}Swatch`]} />{item.role}</span>)}</div>
        <span className={styles.pathOutcome}>Now</span>
        <span>{nextLabel}</span>
      </div>
    </div>
  );
}

function Perspectives({ items }: { items: readonly PerspectiveContribution[] }) {
  return (
    <aside className={styles.perspectives} aria-labelledby="perspectives-title">
      <div className={styles.perspectiveHeading}>
        <div>
          <Eyebrow>Coordinated guidance</Eyebrow>
          <h2 id="perspectives-title">Perspectives behind the plan</h2>
        </div>
        <span>{items.length} relevant now</span>
      </div>

      <div className={styles.perspectiveList} role="region" aria-label="Relevant perspectives; scroll horizontally on smaller screens" tabIndex={0}>
        {items.map((item) => {
          const Icon = toneIcon[item.tone];
          return (
            <article className={`${styles.perspectiveCard} ${styles[item.tone]}`} key={`${item.role}-${item.state}`}>
              <div className={styles.perspectiveIcon} aria-hidden="true"><Icon /></div>
              <div>
                <div className={styles.perspectiveMeta}><h3>{item.role}</h3><span>{item.state}</span></div>
                <p>{item.summary}</p>
              </div>
            </article>
          );
        })}
      </div>

      <p className={styles.perspectiveBoundary}>These are Ashwini reasoning lenses—not messages from providers or proof of human review.</p>
    </aside>
  );
}

export function TodayScreen() {
  const { checkins, derivedDay, selectedTrainingChoice, trainingChoiceSource } = useProduct();
  const now = useNow();
  const reasoningRef = useRef<HTMLDetailsElement>(null);
  const recommendation = currentRecommendation(derivedDay.mealStatus, selectedTrainingChoice, derivedDay.trainingGate, derivedDay.attention, trainingChoiceSource);
  const decisionRecord = activeDecisionRecord(checkins, derivedDay);
  const decisionResponse = decisionRecord ? responseForActiveDecision(decisionRecord) : undefined;
  const perspectives = trainingChoiceSource === "user"
    ? [choicePerspective(selectedTrainingChoice)]
    : decisionResponse?.perspectives.length
      ? decisionResponse.perspectives
      : basePerspectives;
  const events = dayEvents(derivedDay.mealStatus, selectedTrainingChoice, derivedDay.trainingGate, derivedDay.attention, derivedDay.scenarioPhase, trainingChoiceSource);
  const basis = trainingChoiceSource === "user"
    ? "Current session plan selection"
    : decisionRecord && decisionResponse
      ? `${decisionResponse.receipt} · ${decisionRecord.time}`
      : "No check-in has changed today's plan";
  const nextCommitment = nextCommitmentLabel(
    derivedDay.mealStatus,
    selectedTrainingChoice,
    derivedDay.trainingGate,
    derivedDay.attention,
    derivedDay.scenarioPhase,
    trainingChoiceSource,
  );

  const showReasoning = () => {
    const reasoning = reasoningRef.current;
    if (!reasoning) return;
    reasoning.open = true;
    reasoning.scrollIntoView({ block: "nearest" });
    reasoning.querySelector("summary")?.focus({ preventScroll: true });
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="page-title">
        <div className={styles.heroMeta}>
          <div><span>{briefLabel(now)}</span><strong>{now ? nowLabel(now) : "…"}</strong></div>
          <div><span>Next step</span><strong>{nextCommitment}</strong></div>
        </div>

        <div className={styles.heroGrid}>
          <div className={styles.primaryRead}>
            <Eyebrow>Recommended next step</Eyebrow>
            <h1 id="page-title" tabIndex={-1}>{recommendation.headline}</h1>
            <p className={styles.summary}>{recommendation.summary}</p>

            <div className={styles.statusRow}>
              <Status tone={recommendation.tone}><RuleIcon />{recommendation.status}</Status>
              <Status tone={recommendation.tone === "route" ? "route" : "training"}><ClockIcon />{recommendation.recheck}</Status>
            </div>

            <div className={styles.actions}>
              <Link href="/check-in" className={buttonClassName("primary")}>Check in now <ArrowIcon /></Link>
              <Button variant="secondary" onClick={showReasoning}>Why this?</Button>
            </div>

            <details className={styles.reasoning} id="reasoning" ref={reasoningRef}>
              <summary>Why this recommendation</summary>
              <dl>
                <div><dt>Known now</dt><dd>{recommendation.knownNow}</dd></div>
                <div><dt>Evidence state</dt><dd>{recommendation.status} · {basis} · no live provider review</dd></div>
                <div><dt>What changes it</dt><dd>{recommendation.whatChanges}</dd></div>
              </dl>
            </details>
          </div>

          <PerspectivePath items={perspectives} nextLabel={recommendation.nextLabel} />
          <Perspectives items={perspectives} />
        </div>
      </section>

      <section className={styles.timelineSection} aria-labelledby="today-timeline-title">
        <div className={styles.sectionHeading}>
          <div><Eyebrow>Continuity</Eyebrow><h2 id="today-timeline-title">Today</h2></div>
          <p>Only moments that could change a decision appear here.</p>
        </div>

        <div className={styles.timeline}>
          {events.map((event) => (
            <article className={styles[event.state]} key={`${event.time}-${event.title}`}>
              <time>{event.time}</time>
              <span>{event.domain}</span>
              <strong>{event.title}</strong>
              <small>{event.detail}</small>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
