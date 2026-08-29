"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { buttonClassName, Button, Eyebrow, Status, type StatusTone } from "@/components/design-system/ui";
import { ArrowIcon, DocumentIcon, EditIcon, InfoIcon, PhotoIcon, TextIcon, VoiceIcon } from "@/components/product/icons";
import { useProduct } from "@/components/product/product-provider";
import type { CheckinRecord, PerspectiveTone } from "@/lib/product-model";
import { hasMeaningfulCheckinInput } from "@/lib/synthetic-scenario";
import styles from "./checkin-screen.module.css";

// Openers, not fixtures. The advisor classifies whatever is typed, so these are
// only here to show the range of things a check-in can be.
const quickPrompts = [
  "I ate lunch",
  "Slept badly, feeling flat today",
  "My shoulder hurts when I press overhead",
  "Took my morning meds",
  "Can I take magnesium with what I'm on?",
] as const;

function responseTone(record: CheckinRecord): StatusTone {
  if (record.response.kind === "route-out") return "route";
  if (record.response.status === "Rule-based") return "recovery";
  if (record.response.perspectives.some((item) => item.tone === "nutrition")) return "nutrition";
  return "neutral";
}

function currentPlan(
  mealStatus: ReturnType<typeof useProduct>["derivedDay"]["mealStatus"],
  training: ReturnType<typeof useProduct>["selectedTrainingChoice"],
  trainingGate: ReturnType<typeof useProduct>["derivedDay"]["trainingGate"],
  attention: ReturnType<typeof useProduct>["derivedDay"]["attention"],
) {
  if (attention === "urgent-care") return "Urgent human-care handoff open · training plan withheld";
  if (attention === "medication-event") return "Medication-guidance handoff open · training plan withheld";
  if (trainingGate === "blocked") return "Training verdict blocked · human guidance needed";
  if (training === "pause") return "Loaded training paused by your current session choice";
  if (training === "full") return "Full volume selected · not medical clearance";
  if (training === "reduced") return "Reduced volume favored · session remains optional";
  if (trainingGate === "clear") return "3:45 demo check clear · choose full, reduced, or pause";
  if (mealStatus === "recorded") return "Lunch covered · recheck training at 3:45";
  if (mealStatus === "needs-detail") return "Lunch occurred · meal detail still open";
  if (mealStatus === "skipped") return "Lunch remains open · one follow-up needed";
  return "Lunch missing · training held until 3:45";
}

function PerspectiveChip({ tone, children }: { tone: PerspectiveTone; children: string }) {
  return <span className={`${styles.perspectiveChip} ${styles[tone]}`}>{children}</span>;
}

function LatestResponse({ record, onCorrect }: { record: CheckinRecord; onCorrect: () => void }) {
  return (
    <article className={`${styles.latestResponse} ${record.response.kind === "route-out" ? styles.routeOut : ""}`} aria-labelledby={`response-${record.id}`}>
      <div className={styles.responseTopline}>
        <Status tone={responseTone(record)}>{record.response.status}</Status>
        <span>{record.response.gate} gate · {record.time}</span>
      </div>

      <h2 id={`response-${record.id}`}>{record.response.headline}</h2>
      <div className={styles.bedsideSequence}>
        {record.response.acknowledgement && <p><strong>Acknowledged</strong>{record.response.acknowledgement}</p>}
        {record.response.interpretation && <p><strong>Careful read</strong>{record.response.interpretation}</p>}
        <p><strong>Next step</strong>{record.response.recommendation}</p>
        {record.response.followUp && <p><strong>One follow-up</strong>{record.response.followUp}</p>}
      </div>

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
        <Link className={buttonClassName("quiet")} href="/plan">See the plan <ArrowIcon /></Link>
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
        <strong>{record.response.recommendation}</strong>
        {!superseded && <Button variant="quiet" onClick={() => onCorrect(record)}><EditIcon />Correct this record</Button>}
      </div>
    </details>
  );
}

export function CheckinScreen() {
  const { checkins, derivedDay, selectedTrainingChoice, submitCheckin, loading, submitting, error } = useProduct();
  const [draft, setDraft] = useState("");
  const [latestId, setLatestId] = useState<string | null>(null);
  const [correctionOf, setCorrectionOf] = useState<string | undefined>();
  const [modeNotice, setModeNotice] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const latest = useMemo(() => checkins.find((record) => record.id === latestId) ?? checkins.at(-1), [checkins, latestId]);
  const correctionTarget = useMemo(() => checkins.find((record) => record.id === correctionOf), [checkins, correctionOf]);
  const supersededIds = useMemo(() => new Set(checkins.flatMap((record) => record.correctionOf ? [record.correctionOf] : [])), [checkins]);
  const canSubmit = hasMeaningfulCheckinInput(draft) && !submitting;

  useEffect(() => {
    if (!latestId) return;
    const frame = window.requestAnimationFrame(() => responseRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [latestId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    let record: CheckinRecord;
    try {
      record = await submitCheckin(draft, correctionOf);
    } catch {
      // The draft is deliberately left in the textarea. A failed write must not
      // also cost the user their wording.
      setModeNotice("That check-in was not recorded. Your wording is still here — try again.");
      return;
    }
    setLatestId(record.id);
    setDraft("");
    setCorrectionOf(undefined);
    setModeNotice("");
  };

  const prepareCorrection = (record = latest) => {
    if (!record) return;
    setCorrectionOf(record.id);
    setDraft("Correction: ");
    textareaRef.current?.focus();
  };

  const showUnavailableMode = (label: string) => {
    setModeNotice(`${label} intake is not connected yet. Describe it in text; nothing will be uploaded.`);
  };

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <Eyebrow>One check-in · relevant perspectives</Eyebrow>
          <h1 id="page-title" tabIndex={-1}>What’s changed since this morning?</h1>
          <p>Share what happened without choosing a provider, domain, or form. Ashwini records the input, uses only the relevant reasoning lenses, and returns one coordinated next step when the evidence supports one.</p>
        </div>
        <aside>
          <span>Current plan</span>
          <strong>{currentPlan(derivedDay.mealStatus, selectedTrainingChoice, derivedDay.trainingGate, derivedDay.attention)}</strong>
          <small>Recorded, not monitored · nothing here watches you between check-ins</small>
        </aside>
      </header>

      <section className={styles.checkinPanel} aria-labelledby="composer-title">
        <div className={styles.composerIntro}>
          <Eyebrow>Check-in</Eyebrow>
          <h2 id="composer-title">What’s going on?</h2>
          <p>Say what changed in your own words. Ashwini records it, classifies it against its safety rules, and returns one next step — or routes you to a person when that is the right answer.</p>
          <div className={styles.modeList} aria-label="Check-in modes">
            <span><TextIcon />Text</span>
            <button type="button" onClick={() => showUnavailableMode("Photo")}><PhotoIcon />Photo</button>
            <button type="button" onClick={() => showUnavailableMode("Voice")}><VoiceIcon />Voice</button>
            <button type="button" onClick={() => showUnavailableMode("Document")}><DocumentIcon />Document</button>
          </div>
          {modeNotice && <p className={styles.modeNotice} role="status"><InfoIcon />{modeNotice}</p>}
        </div>

        <form className={styles.composer} onSubmit={submit}>
          {correctionTarget && <div className={styles.correctionFlag}><EditIcon />Correcting {correctionTarget.time}: “{correctionTarget.originalInput}”. The original remains visible.</div>}
          <label htmlFor="checkin-input">Your check-in</label>
          <textarea
            id="checkin-input"
            ref={textareaRef}
            rows={5}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Share what changed—food, energy, pain, sleep, medication context, or the decision you need help with."
          />
          <div className={styles.quickPrompts} aria-label="Suggested check-ins">
            {quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => setDraft(prompt)}>{prompt}</button>)}
          </div>
          <div className={styles.composerFooter}>
            <span>Saved to your record · corrections supersede, nothing is deleted</span>
            <Button type="submit" disabled={!canSubmit}>{submitting ? "Recording…" : "Record check-in"} <ArrowIcon /></Button>
          </div>
        </form>
      </section>

      {error && (
        <p className={styles.modeNotice} role="alert">
          <InfoIcon />
          {error} Nothing below is guaranteed current — treat it as unknown rather than as an empty day.
        </p>
      )}

      <div ref={responseRef} tabIndex={-1} className={styles.responseFocus}>
        <div className="sr-only" role="status" aria-live="polite">{latestId && latest ? latest.response.receipt : ""}</div>
        {latest && <LatestResponse record={latest} onCorrect={() => prepareCorrection(latest)} />}
      </div>

      <section className={styles.historySection} aria-labelledby="history-title">
        <div className={styles.historyHeading}>
          <div><Eyebrow>Today’s continuity</Eyebrow><h2 id="history-title">Check-in history</h2></div>
          <p>A chronological record, not a provider chat transcript.</p>
        </div>

        <div className={styles.historyList}>
          {loading && <p className={styles.modeNotice} role="status"><InfoIcon />Loading your record…</p>}
          {checkins.slice().reverse().map((record) => <HistoryRecord key={record.id} record={record} superseded={supersededIds.has(record.id)} onCorrect={prepareCorrection} />)}
          {!loading && !error && checkins.length === 0 && (
            <p className={styles.modeNotice}><InfoIcon />No check-ins recorded yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
