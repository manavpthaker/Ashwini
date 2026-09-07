"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { buttonClassName, Button, Eyebrow, Status, type StatusTone } from "@/components/design-system/ui";
import {
  checkinFailureNotice,
  correctionDraft,
  hasCorrectionChange,
  checkinSubmissionAllowed,
} from "@/components/product/checkin-ux";
import { decisionControlCopy } from "@/components/product/decision-control";
import { ArrowIcon, CheckIcon, DocumentIcon, EditIcon, InfoIcon, PhotoIcon, TextIcon, VoiceIcon } from "@/components/product/icons";
import { useProduct } from "@/components/product/product-provider";
import { ConversationError } from "@/lib/checkin-client";
import type { CheckinRecord, PerspectiveTone } from "@/lib/product-model";
import type { OpenDecision } from "@/lib/record-client";
import styles from "./checkin-screen.module.css";
import { ResponseText } from "./response-text";

// Openers, not fixtures. The advisor classifies whatever is typed, so these are
// only here to show the range of things a check-in can be.
const quickPrompts = [
  "I slept badly and need to decide how to handle training today.",
  "My shoulder hurts when I press overhead—what should I avoid?",
  "I took my morning medication; help me keep the record accurate.",
  "What should I eat before training?",
  "Can I take magnesium with what I'm on?",
] as const;

interface ComposerNotice {
  readonly tone: "info" | "error";
  readonly text: string;
}

function responseTone(record: CheckinRecord): StatusTone {
  if (record.response.kind === "route-out") return "route";
  if (record.response.status === "Rule-based") return "recovery";
  if (record.response.perspectives.some((item) => item.tone === "nutrition")) return "nutrition";
  return "neutral";
}

function currentPlan(
  decision: OpenDecision | undefined,
  latest: CheckinRecord | undefined,
  loading: boolean,
  error: string | null,
) {
  if (loading) return "Opening your private record…";
  if (error) return "Current record unavailable";
  if (decision) return decision.target ?? decision.reply.receipt ?? "Open decision recorded";
  if (latest?.response.decision?.selectedChoice) {
    return `Recorded · ${latest.response.decision.selectedChoice}`;
  }
  if (latest?.response.kind === "follow-up") return latest.response.headline;
  return "No open decision. Add a check-in when something changes.";
}

function stepLabel(record: CheckinRecord): string {
  if (record.response.decision?.selectedChoice) return "Original prompt";
  if (record.response.kind === "follow-up") return "One thing I need";
  if (record.response.kind === "route-out") return "What to do now";
  if (record.response.kind === "record") return "What this made useful";
  return "Do this next";
}

function PerspectiveChip({ tone, children }: { tone: PerspectiveTone; children: string }) {
  return <span className={`${styles.perspectiveChip} ${styles[tone]}`}>{children}</span>;
}

function LatestResponse({
  record,
  openDecision,
  responding,
  decisionNotice,
  decisionError,
  onChoose,
  onAcknowledge,
  onCorrect,
  onAddDetail,
}: {
  record: CheckinRecord;
  openDecision: OpenDecision | undefined;
  responding: boolean;
  decisionNotice: string | null;
  decisionError: string | null;
  onChoose: (choice: string) => void;
  onAcknowledge: () => void;
  onCorrect: () => void;
  onAddDetail: () => void;
}) {
  const selectedChoice = record.response.decision?.selectedChoice;
  const controlCopy = openDecision ? decisionControlCopy(openDecision) : null;
  return (
    <article className={`${styles.latestResponse} ${record.response.kind === "route-out" ? styles.routeOut : ""}`} aria-labelledby={`response-${record.id}`}>
      <div className={styles.responseTopline}>
        <Status tone={responseTone(record)}>{record.response.status}</Status>
        <span>{record.response.gate} gate · {record.time}</span>
      </div>

      <h2 id={`response-${record.id}`}>{record.response.headline}</h2>
      <div className={styles.bedsideSequence}>
        <p><strong>I heard</strong>{record.originalInput}</p>
        {record.response.acknowledgement && <p><strong>Acknowledged</strong>{record.response.acknowledgement}</p>}
        {record.response.interpretation && <p><strong>Careful read</strong>{record.response.interpretation}</p>}
        <p><strong>{stepLabel(record)}</strong><ResponseText text={record.response.recommendation} /></p>
      </div>

      {openDecision ? (
        <section className={styles.inlineDecision} aria-labelledby={`decision-${record.id}`}>
          <div>
            <span>Act on this check-in</span>
            <h3 id={`decision-${record.id}`}>{controlCopy?.heading}</h3>
            <p>{controlCopy?.description}</p>
          </div>
          <div className={styles.inlineChoices}>
            {openDecision.choices.length > 0 ? (
              openDecision.choices.map((choice) => (
                <button
                  type="button"
                  key={choice}
                  disabled={responding}
                  onClick={() => onChoose(choice)}
                >
                  <CheckIcon />
                  <span>{choice}</span>
                </button>
              ))
            ) : (
              <button type="button" disabled={responding} onClick={onAcknowledge}>
                <CheckIcon />
                <span>{controlCopy?.actionLabel}</span>
              </button>
            )}
          </div>
        </section>
      ) : selectedChoice ? (
        <div className={styles.recordedChoice} role="status">
          <CheckIcon />
          <div>
            <span>Your recorded response</span>
            <strong>{selectedChoice}</strong>
            {selectedChoice === "Acknowledged" && (
              <small>The prompt is closed; the underlying concern is not marked resolved.</small>
            )}
          </div>
        </div>
      ) : record.response.kind === "follow-up" ? (
        <div className={styles.followUpAction}>
          <div>
            <span>Complete this check-in</span>
            <strong>Add the missing detail to the record you already started.</strong>
          </div>
          <Button variant="primary" onClick={onAddDetail}>
            Add this detail <ArrowIcon />
          </Button>
        </div>
      ) : null}

      {(decisionError || decisionNotice) && (
        <p
          className={`${styles.decisionFeedback} ${decisionError ? styles.decisionFeedbackError : ""}`}
          role={decisionError ? "alert" : "status"}
        >
          {decisionError ?? decisionNotice}
        </p>
      )}

      {record.response.perspectives.length > 0 && (
        <div className={styles.usedPerspectives}>
          <span>Perspectives used</span>
          <div>{record.response.perspectives.map((item) => <PerspectiveChip tone={item.tone} key={item.role}>{item.role}</PerspectiveChip>)}</div>
          <small>Ashwini synthesis · not messages from providers</small>
        </div>
      )}

      <details className={styles.responseDetails}>
        <summary>What was recorded and why</summary>
        <div className={styles.responseDetailGrid}>
          <div><h3>Recorded</h3><ul>{record.response.recorded.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div>
            <h3>Decision accountability</h3>
            <dl>
              <div><dt>Status</dt><dd>{record.response.status}</dd></div>
              <div><dt>Gate</dt><dd>{record.response.gate}</dd></div>
              {record.response.gateReason && <div><dt>Why that gate</dt><dd>{record.response.gateReason}</dd></div>}
              {record.response.refused && <div><dt>Not claimed</dt><dd>{record.response.refused}</dd></div>}
              <div><dt>Receipt</dt><dd>{record.response.receipt}</dd></div>
            </dl>
          </div>
        </div>
      </details>

      <div className={styles.responseActions}>
        <Button variant="secondary" onClick={onCorrect}><EditIcon />Correct this</Button>
        <Link className={buttonClassName("quiet")} href="/">See Today <ArrowIcon /></Link>
      </div>
    </article>
  );
}

function HistoryRecord({
  record,
  superseded,
  onCorrect,
}: {
  record: CheckinRecord;
  superseded: boolean;
  onCorrect: (record: CheckinRecord) => void;
}) {
  return (
    <details className={styles.historyRecord}>
      <summary>
        <div><time>{record.time}</time><span>{record.correctionOf ? "Correction" : "Check-in"}</span></div>
        <strong>{record.originalInput}</strong>
        <small>{superseded ? "Superseded by correction · " : ""}{record.response.receipt}</small>
      </summary>
      <div>
        <p>{[record.response.acknowledgement, record.response.interpretation].filter(Boolean).join(" ")}</p>
        <ResponseText text={record.response.recommendation} />
        {record.response.decision?.selectedChoice && (
          <small>Recorded response · {record.response.decision.selectedChoice}</small>
        )}
        {!superseded && <Button variant="quiet" onClick={() => onCorrect(record)}><EditIcon />Correct this record</Button>}
      </div>
    </details>
  );
}

export function CheckinScreen() {
  const {
    checkins,
    openDecisions,
    submitCheckin,
    respondToDecision,
    acknowledgeDecision,
    loading,
    historyLoading,
    decisionsLoading,
    historyError,
    decisionsError,
    reloadRecords,
    submitting,
    respondingDecisionId,
    error,
    decisionReceipt,
  } = useProduct();
  const [draft, setDraft] = useState("");
  const [latestId, setLatestId] = useState<string | null>(null);
  const [responseFocusId, setResponseFocusId] = useState<string | null>(null);
  const [correctionOf, setCorrectionOf] = useState<string | undefined>();
  const [addingCorrectionDetail, setAddingCorrectionDetail] = useState(false);
  const [modeNotice, setModeNotice] = useState("");
  const [composerNotice, setComposerNotice] = useState<ComposerNotice | null>(null);
  const [decisionError, setDecisionError] = useState<{
    decisionId: string;
    text: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const consumedCompletionId = useRef<string | null>(null);
  const consumedReviewPrompt = useRef(false);
  const latest = useMemo(() => checkins.find((record) => record.id === latestId) ?? checkins.at(-1), [checkins, latestId]);
  const latestDecision = useMemo(
    () => openDecisions.find((decision) => decision.sourceMessageId === latest?.id),
    [latest, openDecisions],
  );
  const correctionTarget = useMemo(() => checkins.find((record) => record.id === correctionOf), [checkins, correctionOf]);
  const supersededIds = useMemo(() => new Set(checkins.flatMap((record) => record.correctionOf ? [record.correctionOf] : [])), [checkins]);
  const correctionIsReady = correctionTarget
    ? hasCorrectionChange(draft, correctionTarget, addingCorrectionDetail)
    : true;
  const canSubmit = checkinSubmissionAllowed({ draft, submitting, correcting: Boolean(correctionOf), correctionReady: correctionIsReady, historyLoading, historyError });
  const firstRun = !historyLoading && !historyError && checkins.length === 0;

  useEffect(() => {
    if (consumedReviewPrompt.current || typeof window === "undefined") return;
    if (new URL(window.location.href).searchParams.get("review") !== "context") return;
    const frame = window.requestAnimationFrame(() => {
      if (consumedReviewPrompt.current) return;
      consumedReviewPrompt.current = true;
      setDraft("Review my imported health history and wearable summaries. What is the most useful next step for my goals? Explain the evidence, its dates, and the important gaps.");
      setComposerNotice({ tone: "info", text: "Review request prepared. Edit it if useful, then send it to get your read. Nothing has been submitted." });
      textareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!responseFocusId) return;
    const frame = window.requestAnimationFrame(() => responseRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [responseFocusId]);

  const prepareCorrection = useCallback((record: CheckinRecord, addDetail = false) => {
    setLatestId(record.id);
    setCorrectionOf(record.id);
    setAddingCorrectionDetail(addDetail);
    setDraft(correctionDraft(record, addDetail));
    setComposerNotice(null);
    setModeNotice("");
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const cancelCorrection = () => {
    setCorrectionOf(undefined);
    setAddingCorrectionDetail(false);
    setDraft("");
    setComposerNotice({ tone: "info", text: "Correction cancelled. The saved record was not changed." });
    textareaRef.current?.focus();
  };

  const startPrompt = (prompt: string) => {
    const wasCorrecting = Boolean(correctionOf);
    setCorrectionOf(undefined);
    setAddingCorrectionDetail(false);
    setDraft(prompt);
    setModeNotice("");
    setComposerNotice(
      wasCorrecting
        ? { tone: "info", text: "Started a new check-in. The earlier record will not be changed." }
        : null,
    );
    textareaRef.current?.focus();
  };

  useEffect(() => {
    if (historyLoading || historyError || typeof window === "undefined") return;
    const requestedId = new URL(window.location.href).searchParams.get("complete");
    if (!requestedId || consumedCompletionId.current === requestedId) return;
    const frame = window.requestAnimationFrame(() => {
      if (consumedCompletionId.current === requestedId) return;
      consumedCompletionId.current = requestedId;

      const record = checkins.find((item) => item.id === requestedId);
      if (!record) {
        setComposerNotice({
          tone: "error",
          text: "That pending check-in is not in the loaded history. Choose the correct record below before adding detail.",
        });
        return;
      }
      if (supersededIds.has(record.id)) {
        setLatestId(record.id);
        setComposerNotice({
          tone: "info",
          text: "That check-in already has a correction. Its original wording remains visible in history.",
        });
        return;
      }
      if (
        record.response.kind !== "follow-up" ||
        record.response.decision?.selectedChoice
      ) {
        setLatestId(record.id);
        setComposerNotice({
          tone: "info",
          text: "That check-in is no longer waiting for detail. Review its current outcome below.",
        });
        return;
      }

      prepareCorrection(record, true);
      setComposerNotice({
        tone: "info",
        text: `Adding the requested detail to the ${record.time || "selected"} check-in. Edit the wording below, then save it as a correction.`,
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [checkins, historyError, historyLoading, prepareCorrection, supersededIds]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    let record: CheckinRecord;
    try {
      record = await submitCheckin(draft, correctionOf);
    } catch (cause) {
      // The draft is deliberately left in the textarea. A failed write must not
      // also cost the user their wording.
      if (cause instanceof ConversationError && cause.status === 409) {
        setCorrectionOf(undefined);
        setAddingCorrectionDetail(false);
      }
      setComposerNotice({ tone: "error", text: checkinFailureNotice(cause) });
      return;
    }
    setLatestId(record.id);
    setResponseFocusId(record.id);
    setDraft("");
    setCorrectionOf(undefined);
    setAddingCorrectionDetail(false);
    setComposerNotice(null);
    setDecisionError(null);
    setModeNotice("");
  };

  const choose = async (choice: string) => {
    if (!latestDecision) return;
    setDecisionError(null);
    try {
      await respondToDecision(latestDecision.decisionId, choice);
    } catch (cause) {
      setDecisionError({
        decisionId: latestDecision.decisionId,
        text: cause instanceof Error ? cause.message : "The response was not recorded.",
      });
    }
  };

  const acknowledge = async () => {
    if (!latestDecision) return;
    setDecisionError(null);
    try {
      await acknowledgeDecision(latestDecision.decisionId);
    } catch (cause) {
      setDecisionError({
        decisionId: latestDecision.decisionId,
        text: cause instanceof Error ? cause.message : "The acknowledgment was not recorded.",
      });
    }
  };

  const showUnavailableMode = (label: string) => {
    setModeNotice(`${label} intake is not connected yet. Describe it in text; nothing will be uploaded.`);
  };

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <Eyebrow>One check-in · relevant perspectives</Eyebrow>
          <h1 id="page-title" tabIndex={-1}>{firstRun ? "What do you need help with today?" : "What changed?"}</h1>
          <p>Share what happened without choosing a provider, domain, or form. Ashwini records the input, uses only the relevant reasoning lenses, and returns one coordinated next step when the evidence supports one.</p>
        </div>
        <aside>
          <span>Current plan</span>
          <strong>{currentPlan(openDecisions[0], latest, decisionsLoading, decisionsError)}</strong>
          <small>Recorded, not monitored · nothing here watches you between check-ins</small>
        </aside>
      </header>

      <section className={styles.checkinPanel} aria-labelledby="composer-title">
        <div className={styles.composerIntro}>
          <Eyebrow>Check-in</Eyebrow>
          <h2 id="composer-title">{firstRun ? "Start with the decision or change that matters." : "What’s going on?"}</h2>
          <p>Say what changed or the choice in front of you. Ashwini returns one bounded action, one useful question, or a clear professional boundary—then keeps that outcome with the record.</p>
          <div className={styles.modeList} aria-label="Check-in modes">
            <span><TextIcon />Text</span>
            <button type="button" onClick={() => showUnavailableMode("Photo")}><PhotoIcon />Photo</button>
            <button type="button" onClick={() => showUnavailableMode("Voice")}><VoiceIcon />Voice</button>
            <button type="button" onClick={() => showUnavailableMode("Document")}><DocumentIcon />Document</button>
          </div>
          {modeNotice && <p className={styles.modeNotice} role="status"><InfoIcon />{modeNotice}</p>}
        </div>

        <form className={styles.composer} onSubmit={submit}>
          {correctionTarget && (
            <div className={styles.correctionFlag}>
              <span><EditIcon />Correcting {correctionTarget.time}: “{correctionTarget.originalInput}”. The original remains visible.</span>
              <button type="button" onClick={cancelCorrection}>Cancel correction</button>
            </div>
          )}
          {composerNotice && (
            <p
              className={`${styles.composerNotice} ${composerNotice.tone === "error" ? styles.composerNoticeError : ""}`}
              role={composerNotice.tone === "error" ? "alert" : "status"}
            >
              <InfoIcon />{composerNotice.text}
            </p>
          )}
          <label htmlFor="checkin-input">Your check-in</label>
          <textarea
            id="checkin-input"
            ref={textareaRef}
            rows={5}
            maxLength={4000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Share what changed—food, energy, pain, sleep, medication context, or the decision you need help with."
          />
          <div className={styles.quickPrompts} aria-label="Suggested check-ins">
            {quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => startPrompt(prompt)}>{prompt}</button>)}
          </div>
          <div className={styles.composerFooter}>
            <span>Saved to your record · corrections supersede, nothing is deleted</span>
            <Button type="submit" disabled={!canSubmit}>
              {submitting
                ? "Preparing your response…"
                : "Save check-in and get my read"}{" "}
              <ArrowIcon />
            </Button>
          </div>
        </form>
      </section>

      {error && (
        <p className={`${styles.surfaceNotice} ${styles.surfaceNoticeError}`} role="alert">
          <InfoIcon />
          {error} You can still send a new check-in. Previously loaded records may be out of date.
          <Button variant="secondary" onClick={() => void reloadRecords()} disabled={loading}>Retry record reads</Button>
        </p>
      )}

      <div ref={responseRef} tabIndex={-1} className={styles.responseFocus}>
        <div className="sr-only" role="status" aria-live="polite">{latestId && latest ? latest.response.receipt : ""}</div>
        {latest && (
          <LatestResponse
            record={latest}
            openDecision={latestDecision}
            responding={respondingDecisionId === latestDecision?.decisionId}
            decisionNotice={
              decisionReceipt && decisionReceipt.decisionId === latest.response.decision?.id
                ? decisionReceipt.text
                : null
            }
            decisionError={
              decisionError && decisionError.decisionId === latest.response.decision?.id
                ? decisionError.text
                : null
            }
            onChoose={(choice) => void choose(choice)}
            onAcknowledge={() => void acknowledge()}
            onCorrect={() => prepareCorrection(latest)}
            onAddDetail={() => prepareCorrection(latest, true)}
          />
        )}
      </div>

      <section className={styles.historySection} aria-labelledby="history-title">
        <div className={styles.historyHeading}>
          <div><Eyebrow>Continuity</Eyebrow><h2 id="history-title">Recent check-ins</h2></div>
          <p>A chronological record, not a provider chat transcript.</p>
        </div>

        <div className={styles.historyList}>
          {historyLoading && <p className={styles.surfaceNotice} role="status"><InfoIcon />Loading recent check-ins…</p>}
          {checkins.slice().reverse().map((record) => <HistoryRecord key={record.id} record={record} superseded={supersededIds.has(record.id)} onCorrect={prepareCorrection} />)}
          {!historyLoading && !historyError && checkins.length === 0 && (
            <p className={styles.surfaceNotice}><InfoIcon />No check-ins recorded yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
