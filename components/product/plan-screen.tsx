"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DOMAIN_LABEL } from "@/domain/domains";
import { EVIDENCE_LABEL, EVIDENCE_MEANING, EVIDENCE_STATUSES } from "@/domain/evidence";
import { buttonClassName, Eyebrow, Status, type StatusTone } from "@/components/design-system/ui";
import {
  decisionControlCopy,
  latestRecordedDecisionResponse,
} from "@/components/product/decision-control";
import {
  ArrowIcon,
  CheckIcon,
  ClockIcon,
  InfoIcon,
  RuleIcon,
  ShieldIcon,
} from "@/components/product/icons";
import { useProduct } from "@/components/product/product-provider";
import {
  fetchPlanSnapshot,
  RecordApiError,
  type OpenDecision,
  type PlanSnapshot,
  type RoutineStatus,
} from "@/lib/record-client";
import styles from "./plan-screen.module.css";

function decisionTone(decision: OpenDecision): StatusTone {
  if (decision.route || decision.gateOutcome === "blocked") return "route";
  if (decision.domain === "nutrition") return "nutrition";
  if (decision.domain === "training") return "training";
  return "recovery";
}

function decisionHeadline(decision: OpenDecision): string {
  if (decision.route === "emergency") return "Emergency care is the next step.";
  if (decision.route === "crisis_line") return "An appropriate crisis service is the next step.";
  if (decision.route === "pharmacist") return "A pharmacist should answer this decision.";
  if (decision.route === "prescriber") return "Your prescriber should answer this decision.";
  if (decision.route === "clinician") return "A clinician needs to review this decision.";
  if (decision.route === "dermatologist")
    return "This is documented for a dermatologist, not assessed here.";
  return decision.target ?? (decision.reply.receipt || "A decision is open.");
}

function routineTone(status: RoutineStatus): StatusTone {
  if (status === "active") return "training";
  if (status === "paused") return "warning";
  return "neutral";
}

function formatDate(iso: string | null, timeZone: string): string {
  if (!iso) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(new Date(iso));
}

function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

export function PlanScreen() {
  const router = useRouter();
  const {
    checkins,
    openDecisions,
    respondToDecision,
    acknowledgeDecision,
    loading: recordLoading,
    respondingDecisionId,
    error: recordError,
    decisionReceipt,
    timeZone: recordTimeZone,
  } = useProduct();
  const [snapshot, setSnapshot] = useState<PlanSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [choiceError, setChoiceError] = useState<{
    readonly decisionId: string;
    readonly text: string;
  } | null>(null);
  const decision = !recordLoading && !recordError ? openDecisions[0] : undefined;
  const latestRecordedResponse = useMemo(
    () => latestRecordedDecisionResponse(checkins),
    [checkins],
  );
  const recordedChoice = latestRecordedResponse?.response.decision?.selectedChoice;
  const controlCopy = decision ? decisionControlCopy(decision) : null;

  useEffect(() => {
    const controller = new AbortController();
    fetchPlanSnapshot(controller.signal)
      .then((value) => {
        setSnapshot(value);
        setSnapshotError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof RecordApiError && cause.status === 401) {
          router.replace("/login");
          return;
        }
        setSnapshotError(cause instanceof Error ? cause.message : "Plan records are unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setSnapshotLoading(false);
      });
    return () => controller.abort();
  }, [router]);

  const latestReview = snapshot?.reviews[0];
  const reviewedRoutine = useMemo(
    () => snapshot?.routines.find((routine) => routine.id === latestReview?.routineId),
    [snapshot, latestReview],
  );
  const headerStatus =
    recordLoading || snapshotLoading
      ? "Loading saved plan records…"
      : recordError || snapshotError
        ? "Saved plan records unavailable"
        : `${openDecisions.length} open decision${openDecisions.length === 1 ? "" : "s"} · ${snapshot?.routines.length ?? 0} saved routine${snapshot?.routines.length === 1 ? "" : "s"}`;

  const choose = async (choice: string) => {
    if (!decision) return;
    const decisionId = decision.decisionId;
    setChoiceError(null);
    try {
      await respondToDecision(decisionId, choice);
    } catch (cause) {
      setChoiceError({
        decisionId,
        text: cause instanceof Error ? cause.message : "The response was not recorded.",
      });
    }
  };

  const acknowledge = async () => {
    if (!decision) return;
    const decisionId = decision.decisionId;
    setChoiceError(null);
    try {
      await acknowledgeDecision(decisionId);
    } catch (cause) {
      setChoiceError({
        decisionId,
        text: cause instanceof Error ? cause.message : "The acknowledgment was not recorded.",
      });
    }
  };

  const planTimeZone = snapshot?.timeZone ?? recordTimeZone;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <Eyebrow>Plan + review</Eyebrow>
          <h1 id="page-title" tabIndex={-1}>
            Every plan stays attached to its record.
          </h1>
          <p>
            Open decisions, saved routines, and evidence-labeled reviews appear only when they exist
            in your private record.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link className={buttonClassName("primary")} href="/check-in">
            Add a check-in <ArrowIcon />
          </Link>
          <span>{headerStatus}</span>
        </div>
      </header>

      <section
        className={`${styles.currentDecision} ${decision?.gateOutcome === "blocked" ? styles.blockedDecision : ""}`}
        aria-labelledby="current-decision-title"
      >
        <div className={styles.decisionSummary}>
          {recordLoading ? (
            <div className={styles.emptyState}>
              <Eyebrow>Private record</Eyebrow>
              <h2 id="current-decision-title">Opening current decisions…</h2>
              <p>No decision controls are shown until the read completes.</p>
            </div>
          ) : recordError ? (
            <div className={styles.emptyState}>
              <Eyebrow>Record unavailable</Eyebrow>
              <h2 id="current-decision-title">Ashwini cannot tell what is current.</h2>
              <p>{recordError} No plan state is inferred from the failure.</p>
            </div>
          ) : decision ? (
            <>
              <div className={styles.decisionTopline}>
                <Status tone={decisionTone(decision)}>
                  {EVIDENCE_LABEL[decision.evidenceStatus]}
                </Status>
                <span>
                  <ClockIcon />
                  {formatDateTime(decision.createdAt, recordTimeZone)}
                </span>
              </div>
              <Eyebrow>{DOMAIN_LABEL[decision.domain]}</Eyebrow>
              <h2 id="current-decision-title">{decisionHeadline(decision)}</h2>
              <p>{decision.reply.text}</p>
              <div className={styles.decisionBasis}>
                <span>
                  <RuleIcon />
                  {decision.ruleId}
                </span>
                <span>{decision.gateOutcome} gate</span>
                <span>{decision.advisorVersion}</span>
                {decision.expectedLag && <span>Expected lag: {decision.expectedLag}</span>}
                <span>No human review implied</span>
              </div>
              <details className={styles.decisionDetails}>
                <summary>Reasoning and boundary</summary>
                <dl>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{decision.confidenceNote}</dd>
                  </div>
                  <div>
                    <dt>Gate basis</dt>
                    <dd>{decision.gateReason}</dd>
                  </div>
                  <div>
                    <dt>Not claimed</dt>
                    <dd>{decision.refused}</dd>
                  </div>
                </dl>
              </details>
            </>
          ) : recordedChoice ? (
            <div className={styles.emptyState}>
              <div className={styles.decisionTopline}>
                <Status tone={recordedChoice === "Acknowledged" ? "neutral" : "training"}>
                  Recorded response
                </Status>
                {latestRecordedResponse?.response.decision?.respondedAt && (
                  <span>
                    <ClockIcon />
                    {formatDateTime(
                      latestRecordedResponse.response.decision.respondedAt,
                      recordTimeZone,
                    )}
                  </span>
                )}
              </div>
              <Eyebrow>Latest completed decision</Eyebrow>
              <h2 id="current-decision-title">{recordedChoice}</h2>
              <p>
                {recordedChoice === "Acknowledged"
                  ? "The prompt is closed in Ashwini; the underlying concern is not marked resolved."
                  : "This response remains attached to the check-in that produced the decision."}
              </p>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <Eyebrow>Current decisions</Eyebrow>
              <h2 id="current-decision-title">No open decision.</h2>
              <p>
                Ashwini is not filling this space with a default training plan. Add a check-in when
                something changes or you need help deciding.
              </p>
            </div>
          )}
        </div>

        <div className={styles.choicePanel}>
          <h3>
            {recordLoading
              ? "Opening decision controls"
              : recordError
                ? "Decision controls withheld"
                : decision
                  ? decision.choices.length
                    ? "Your available responses"
                    : controlCopy?.heading
                  : recordedChoice
                    ? "Response recorded"
                  : "Nothing to answer"}
          </h3>
          <p>
            {recordLoading
              ? "No response can be recorded until the private record read completes."
              : recordError
                ? "Ashwini cannot establish which decision is current, so no stale response is available."
              : decision
              ? controlCopy?.description
              : recordedChoice
                ? `Your latest recorded response is “${recordedChoice}.” Add a new check-in if the situation changes.`
              : "A choice panel appears only when a saved decision includes choices."}
          </p>
          {decision?.choices.length ? (
            <p className={styles.choiceBoundary}>
              Recording a choice does not contact a provider, start a capture, or change another
              saved record.
            </p>
          ) : null}
          {decision?.choices.length ? (
            <div className={styles.choiceList}>
              {decision.choices.map((choice) => (
                <button
                  type="button"
                  key={choice}
                  disabled={respondingDecisionId === decision.decisionId}
                  onClick={() => void choose(choice)}
                >
                  <i aria-hidden="true">
                    <CheckIcon />
                  </i>
                  <span>
                    <strong>{choice}</strong>
                    <small>
                      Record this response against decision {decision.decisionId.slice(0, 8)}.
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {decision && decision.choices.length === 0 ? (
            <div className={styles.choiceList}>
              <button
                type="button"
                disabled={respondingDecisionId === decision.decisionId}
                onClick={() => void acknowledge()}
              >
                <i aria-hidden="true">
                  <CheckIcon />
                </i>
                <span>
                  <strong>{controlCopy?.actionLabel}</strong>
                  <small>{controlCopy?.description}</small>
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <div
        className={`${styles.planReceipt} ${choiceError ? styles.planError : ""}`}
        role={choiceError ? "alert" : "status"}
        aria-live={choiceError ? "assertive" : "polite"}
      >
        {choiceError ? (
          <>
            <InfoIcon />
            <span>
              {choiceError.text}
              {recordedChoice ? ` Current record: “${recordedChoice}.”` : ""}
            </span>
          </>
        ) : decisionReceipt ? (
          <>
            <CheckIcon />
            <span>
              {decisionReceipt.text} · decision {decisionReceipt.decisionId.slice(0, 8)}
            </span>
          </>
        ) : decision && recordedChoice ? (
          <>
            <CheckIcon />
            <span>Latest recorded response · {recordedChoice}</span>
          </>
        ) : null}
      </div>

      <section className={styles.routinesSection} aria-labelledby="routines-title">
        <div className={styles.sectionHeading}>
          <div>
            <Eyebrow>Saved routines</Eyebrow>
            <h2 id="routines-title">What you are deliberately repeating</h2>
          </div>
          <p>
            Counts and reviews come from your saved routine record. Nothing is inferred when a
            record is missing.
          </p>
        </div>

        {snapshotLoading ? (
          <p className={styles.sectionEmpty} role="status">
            Loading saved routines…
          </p>
        ) : snapshotError ? (
          <p className={styles.sectionEmpty} role="alert">
            {snapshotError} No routine count is being inferred.
          </p>
        ) : snapshot?.routines.length ? (
          <div className={styles.routineGrid}>
            {snapshot.routines.map((routine) => (
              <article key={routine.id}>
                <div className={styles.routineTopline}>
                  <Status tone={routineTone(routine.status)}>{routine.status}</Status>
                  <span>
                    {routine.progress.comparable} comparable · {routine.progress.excluded} excluded
                  </span>
                </div>
                <p>{DOMAIN_LABEL[routine.domain]}</p>
                <h3>{routine.name}</h3>
                <details>
                  <summary>Routine details and evidence</summary>
                  <dl>
                    <div>
                      <dt>Behavior</dt>
                      <dd>{routine.behavior}</dd>
                    </div>
                    <div>
                      <dt>Target</dt>
                      <dd>{routine.target}</dd>
                    </div>
                    <div>
                      <dt>Expected lag</dt>
                      <dd>{routine.expectedLag}</dd>
                    </div>
                    <div>
                      <dt>Review</dt>
                      <dd>{formatDate(routine.reviewAt, planTimeZone)}</dd>
                    </div>
                  </dl>
                  <p>
                    <strong>Evidence</strong>
                    {routine.latestReview
                      ? `${EVIDENCE_LABEL[routine.latestReview.evidenceStatus]} · ${routine.latestReview.summary}`
                      : "No review recorded yet."}
                  </p>
                  <p>
                    <strong>Confounds</strong>
                    {routine.confoundIds.length
                      ? routine.confoundIds.join(", ")
                      : "None declared in the saved routine."}
                  </p>
                  {routine.stopBoundary && (
                    <p>
                      <strong>Stop boundary</strong>
                      {routine.stopBoundary}
                    </p>
                  )}
                </details>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.sectionEmpty}>
            No active, candidate, or paused routines are saved yet.
          </p>
        )}
      </section>

      <section className={styles.reviewSection} aria-labelledby="review-title">
        {snapshotLoading ? (
          <div className={styles.reviewLead}>
            <Eyebrow>Evidence review</Eyebrow>
            <h2 id="review-title">Loading saved reviews…</h2>
            <p>No evidence count or conclusion is shown until the record read completes.</p>
          </div>
        ) : snapshotError ? (
          <div className={styles.reviewLead}>
            <Eyebrow>Review unavailable</Eyebrow>
            <h2 id="review-title">Ashwini cannot tell whether a review exists.</h2>
            <p>{snapshotError} No evidence count or conclusion is being inferred.</p>
          </div>
        ) : latestReview ? (
          <>
            <div className={styles.reviewLead}>
              <Eyebrow>Latest saved review</Eyebrow>
              <h2 id="review-title">{reviewedRoutine?.name ?? "Routine review"}</h2>
              <p>{latestReview.summary}</p>
              <div>
                <Status tone="nutrition">{EVIDENCE_LABEL[latestReview.evidenceStatus]}</Status>
              </div>
            </div>
            <div className={styles.claimPair}>
              <article>
                <span>Comparable with</span>
                <strong>{latestReview.withCount}</strong>
              </article>
              <article>
                <span>Comparable without</span>
                <strong>{latestReview.withoutCount}</strong>
              </article>
              <article>
                <span>Excluded</span>
                <strong>{latestReview.excludedCount}</strong>
              </article>
              <article>
                <span>Not supported</span>
                <strong>{latestReview.refused}</strong>
              </article>
              <small>Recorded {formatDateTime(latestReview.reviewedAt, planTimeZone)}</small>
            </div>
          </>
        ) : (
          <>
            <div className={styles.reviewLead}>
              <Eyebrow>Evidence review</Eyebrow>
              <h2 id="review-title">No review recorded yet.</h2>
              <p>
                A review will appear only after a saved routine has enough comparable evidence and
                an explicit review record.
              </p>
            </div>
            <div className={styles.claimPair}>
              <small>No evidence count or conclusion has been invented.</small>
            </div>
          </>
        )}
      </section>

      <section className={styles.secondarySection} aria-label="Evidence and privacy context">
        <details>
          <summary>
            <span>
              <InfoIcon />
              <strong>Evidence labels used here</strong>
            </span>
            <small>Contextual reference</small>
          </summary>
          <div className={styles.definitionGrid}>
            {EVIDENCE_STATUSES.map((status) => (
              <article key={status}>
                <strong>{EVIDENCE_LABEL[status]}</strong>
                <p>{EVIDENCE_MEANING[status]}</p>
              </article>
            ))}
          </div>
        </details>
        <details>
          <summary>
            <span>
              <ShieldIcon />
              <strong>Data and privacy status</strong>
            </span>
            <small>Private record</small>
          </summary>
          <div className={styles.privacyCopy}>
            <p>
              Check-ins, decisions, responses, routines, occurrences, and reviews shown here come
              from the authenticated private Postgres record. Corrections supersede earlier
              check-ins instead of erasing them.
            </p>
            <p>
              Photo, voice, and document intake and the live evidence connector are still
              unavailable. Nothing on this screen implies a licensed provider reviewed the record.
            </p>
          </div>
        </details>
      </section>
    </div>
  );
}
