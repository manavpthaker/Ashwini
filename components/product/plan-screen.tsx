"use client";

import Link from "next/link";
import { buttonClassName, Eyebrow, Status } from "@/components/design-system/ui";
import { ArrowIcon, CheckIcon, ClockIcon, InfoIcon, RuleIcon, ShieldIcon } from "@/components/product/icons";
import { useProduct } from "@/components/product/product-provider";
import { evidenceDefinitions, routines, weeklyReview } from "@/lib/product-data";
import type { AttentionState, TrainingChoice } from "@/lib/product-model";
import { planIsLocked } from "@/lib/synthetic-scenario";
import styles from "./plan-screen.module.css";

const trainingChoices: readonly { id: TrainingChoice; label: string; detail: string }[] = [
  { id: "hold", label: "Hold until 3:45", detail: "Keep the session on the calendar without deciding volume yet." },
  { id: "full", label: "Full volume", detail: "Choose only after the pre-session check remains clear." },
  { id: "reduced", label: "Reduced volume", detail: "Use the declared lower-volume version of the existing plan." },
  { id: "pause", label: "Pause loaded training", detail: "Pause the loaded session by choice; route to a human if the facts require it." },
] as const;

function choiceHeadline(
  choice: TrainingChoice,
  locked: boolean,
  attention: AttentionState,
  gate: ReturnType<typeof useProduct>["derivedDay"]["trainingGate"],
) {
  if (attention === "urgent-care") return "Routine planning is withheld while urgent human care is the next step.";
  if (attention === "medication-event") return "Routine planning is withheld while medication guidance is open.";
  if (locked) return "Loaded training is paused while the training gate is blocked.";
  if (choice === "full") return "Full volume is selected for this session preview.";
  if (choice === "reduced") return "Reduced volume is the current plan.";
  if (choice === "pause") return "Loaded training is paused by your current session choice.";
  if (gate === "clear") return "The 3:45 check is complete. The volume choice remains open.";
  return "The session is held. Volume waits until 3:45.";
}

function gateCopy(
  gate: ReturnType<typeof useProduct>["derivedDay"]["trainingGate"],
  attention: ReturnType<typeof useProduct>["derivedDay"]["attention"],
) {
  if (attention === "urgent-care") return "A declared urgent demo event has priority. Ashwini stops routine planning and routes to immediate human care; another synthetic check-in cannot clear this handoff.";
  if (attention === "medication-event") return "A declared unexpected-dose or possible-side-effect event has priority. Get advice from a pharmacist, prescriber, or appropriate urgent service before returning to routine planning.";
  if (gate === "blocked") return "A declared pain or urgent demo check-in blocked the loaded-training verdict. Full and reduced volume remain unavailable until appropriate human judgment resolves the block.";
  if (gate === "caution") return "Low energy plus short sleep activates the declared caution rule. Reduced volume is favored, and the session remains optional.";
  if (gate === "clear") return "The declared 3:45 energy-and-shoulder fixture is clear. Full, reduced, or pause are available as user choices; none is medical clearance.";
  return "Short sleep is a caution, not a verdict. Use the declared 3:45 energy-and-shoulder check before full volume becomes available.";
}

export function PlanScreen() {
  const { derivedDay, selectedTrainingChoice, trainingChoiceSource, chooseTraining, planReceipt } = useProduct();
  const locked = planIsLocked(derivedDay);
  const userChoice = trainingChoiceSource === "user";
  const decisionTiming = derivedDay.attention !== "none"
    ? "Human handoff · now"
    : derivedDay.trainingGate === "blocked"
      ? "Human guidance needed"
      : userChoice
        ? selectedTrainingChoice === "pause" ? "User choice · paused" : "Current-session choice"
        : derivedDay.trainingGate === "clear" || derivedDay.trainingGate === "caution"
          ? "Decision point · now"
          : "Decision point · 3:45 PM";
  const decisionStatus = locked ? "Handoff open" : userChoice ? "Recorded" : derivedDay.trainingGate === "clear" ? "Clear demo gate" : "Rule-based";
  const decisionTone = locked ? "route" : userChoice && selectedTrainingChoice === "reduced" ? "recovery" : derivedDay.trainingGate === "clear" || userChoice ? "training" : "recovery";

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <Eyebrow>Plan + review</Eyebrow>
          <h1 id="page-title" tabIndex={-1}>A plan that keeps its reasoning attached.</h1>
          <p>Current decisions, active routines, and evidence-labeled reviews live together. Nothing here silently becomes medical advice or a personal fact.</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={buttonClassName("primary")} href="/check-in">Add a check-in <ArrowIcon /></Link>
          <span>2 active routines · 1 review due</span>
        </div>
      </header>

      <section className={`${styles.currentDecision} ${locked ? styles.blockedDecision : ""}`} aria-labelledby="training-choice-title">
        <div className={styles.decisionSummary}>
          <div className={styles.decisionTopline}>
            <Status tone={decisionTone}>{decisionStatus}</Status>
            <span><ClockIcon />{decisionTiming}</span>
          </div>
          <Eyebrow>Today’s training decision</Eyebrow>
          <h2 id="training-choice-title">{choiceHeadline(selectedTrainingChoice, locked, derivedDay.attention, derivedDay.trainingGate)}</h2>
          <p>{gateCopy(derivedDay.trainingGate, derivedDay.attention)}</p>
          <div className={styles.decisionBasis}>
            <span><RuleIcon />{locked ? "Protected state" : userChoice ? "Current-session choice" : "Rule v0.2"}</span>
            <span>6h 18m sleep</span>
            <span>{derivedDay.mealStatus === "recorded" ? "Lunch recorded" : "Lunch not complete"}</span>
            {userChoice && <span>Underlying gate: {derivedDay.trainingGate}</span>}
            {derivedDay.attention !== "none" && <span>Human handoff open</span>}
            <span>No medical clearance implied</span>
          </div>
        </div>

        <div className={styles.choicePanel}>
          <h3>{locked ? "Protected state" : "Choose the current plan"}</h3>
          <p>{locked
            ? `${derivedDay.attention !== "none" ? "The open human handoff" : "The active training gate"} keeps loaded training paused. This is a protective system state—not a user selection, diagnosis, or medical conclusion.`
            : "The user makes the decision. Ashwini keeps the selection and its receipt; it does not make the call for you."}</p>
          <div className={styles.choiceList}>
            {trainingChoices.map((choice) => {
              const safetyDisabled = locked || (choice.id === "full" && derivedDay.trainingGate !== "clear");
              const holdAfterCheck = choice.id === "hold" && derivedDay.scenarioPhase === "pre-session";
              const choiceLabel = holdAfterCheck ? "Keep decision open" : choice.label;
              const choiceDetail = holdAfterCheck ? "Leave volume unselected for now." : choice.detail;
              const disabledReason = locked && choice.id === "pause"
                ? "Required while the current handoff is open; another selection cannot resolve it."
                : locked
                  ? "Unavailable while the current handoff is open."
                  : "Available only while the training gate is clear.";
              return (
                <button
                  type="button"
                  key={choice.id}
                  aria-pressed={selectedTrainingChoice === choice.id}
                  disabled={safetyDisabled}
                  onClick={() => chooseTraining(choice.id)}
                >
                  <i aria-hidden="true">{selectedTrainingChoice === choice.id && <CheckIcon />}</i>
                  <span><strong>{choiceLabel}</strong><small>{safetyDisabled ? disabledReason : choiceDetail}</small></span>
                </button>
              );
            })}
          </div>
          <div className={styles.planReceipt} role="status" aria-live="polite">{planReceipt && <><CheckIcon /><span>{planReceipt}</span></>}</div>
        </div>
      </section>

      <section className={styles.routinesSection} aria-labelledby="routines-title">
        <div className={styles.sectionHeading}>
          <div><Eyebrow>Active routines</Eyebrow><h2 id="routines-title">What you are deliberately repeating</h2></div>
          <p>Each routine has one behavior, one target, a review point, and visible confounds.</p>
        </div>

        <div className={styles.routineGrid}>
          {routines.map((routine) => (
            <article key={routine.id}>
              <div className={styles.routineTopline}><Status tone={routine.status === "Tracking" ? "recovery" : "nutrition"}>{routine.status}</Status><span>{routine.progress}</span></div>
              <p>{routine.domain}</p>
              <h3>{routine.title}</h3>
              <details>
                <summary>Routine details and evidence</summary>
                <dl>
                  <div><dt>Behavior</dt><dd>{routine.behavior}</dd></div>
                  <div><dt>Target</dt><dd>{routine.target}</dd></div>
                  <div><dt>Review</dt><dd>{routine.nextReview}</dd></div>
                </dl>
                <p><strong>Current evidence</strong>{routine.evidence}</p>
                <p><strong>Confounds</strong>{routine.confounds}</p>
              </details>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.reviewSection} aria-labelledby="review-title">
        <div className={styles.reviewLead}>
          <Eyebrow>Weekly review</Eyebrow>
          <h2 id="review-title">{weeklyReview.title}</h2>
          <p>{weeklyReview.summary}</p>
          <div><Status tone="nutrition">{weeklyReview.status}</Status><Status tone="warning">{weeklyReview.gate} gate</Status></div>
        </div>
        <div className={styles.claimPair}>
          <article><span>Supported</span><strong>{weeklyReview.allowed}</strong></article>
          <article><span>Not supported</span><strong>{weeklyReview.refused}</strong></article>
          <small>Next review · {weeklyReview.nextReview}</small>
        </div>
      </section>

      <section className={styles.secondarySection} aria-label="Evidence and privacy context">
        <details>
          <summary><span><InfoIcon /><strong>Evidence labels used here</strong></span><small>Contextual reference</small></summary>
          <div className={styles.definitionGrid}>{evidenceDefinitions.map((definition) => <article key={definition.status}><strong>{definition.status}</strong><p>{definition.meaning}</p></article>)}</div>
        </details>
        <details>
          <summary><span><ShieldIcon /><strong>Data and privacy status</strong></span><small>Partly connected</small></summary>
          <div className={styles.privacyCopy}>
            <p>Check-ins are real: they are recorded against your account in managed Postgres, classified by Ashwini&rsquo;s safety rules, and kept append-only, so a correction supersedes a record rather than erasing it. Routines, the weekly review, and the day timeline below are still fixtures, and attachments and the live evidence connector are not wired up.</p>
            <p>Storage and hosting are disclosed managed processors. Retention, deletion, backups, and a rehearsed restore are documented in the privacy note and remain the gate on ingesting anything beyond your own check-ins.</p>
          </div>
        </details>
      </section>
    </div>
  );
}
