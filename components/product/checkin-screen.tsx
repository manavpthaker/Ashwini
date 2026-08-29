"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { buttonClassName, Button, Eyebrow, Status, type StatusTone } from "@/components/design-system/ui";
import { ArrowIcon, DocumentIcon, EditIcon, InfoIcon, PhotoIcon, TextIcon, UndoIcon, VoiceIcon } from "@/components/product/icons";
import { useProduct } from "@/components/product/product-provider";
import type { CheckinRecord, PerspectiveTone } from "@/lib/product-model";
import { hasMeaningfulCheckinInput } from "@/lib/synthetic-scenario";
import styles from "./checkin-screen.module.css";

const quickPrompts = [
  "I ate lunch",
  "House Dal v1 with rice and yogurt",
  "I skipped lunch",
  "I feel flat",
  "Simulate 3:45 · Energy normal, shoulder quiet",
  "My shoulder hurts",
] as const;

const initialHistory = [
  { time: "7:36 AM", label: "Breakfast", detail: "Two eggs, toast, and coffee · sleep 6h 18m", receipt: "Nutrition estimate · medium confidence" },
  { time: "8:03 AM", label: "Medication", detail: "Prescription A reported taken · supply count 14", receipt: "User-reported adherence context" },
  { time: "10:12 AM", label: "Morning check-in", detail: "Energy normal · shoulder quiet · focus 4/5", receipt: "Training context recorded" },
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

function LatestResponse({ record, onUndo, onCorrect }: { record: CheckinRecord; onUndo: () => void; onCorrect: () => void }) {
  return (
    <article className={`${styles.latestResponse} ${record.response.kind === "route-out" ? styles.routeOut : ""}`} aria-labelledby={`response-${record.id}`}>
      <div className={styles.responseTopline}>
        <Status tone={responseTone(record)}>{record.response.status}</Status>
        <span>{record.response.gate} gate · {record.time}</span>
      </div>

      <h2 id={`response-${record.id}`}>{record.response.headline}</h2>
      <div className={styles.bedsideSequence}>
        <p><strong>Acknowledged</strong>{record.response.acknowledgement}</p>
        <p><strong>Careful read</strong>{record.response.interpretation}</p>
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
          <div><h3>Recorded in this session</h3><ul>{record.response.recorded.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div><h3>Decision accountability</h3><dl><div><dt>Status</dt><dd>{record.response.status}</dd></div><div><dt>Gate</dt><dd>{record.response.gate}</dd></div><div><dt>Receipt</dt><dd>{record.response.receipt}</dd></div></dl></div>
        </div>
      </details>

      <div className={styles.responseActions}>
        <Button variant="secondary" onClick={onCorrect}><EditIcon />Correct this</Button>
        <Button variant="quiet" onClick={onUndo}><UndoIcon />Undo last check-in</Button>
        <Link className={buttonClassName("quiet")} href="/plan/">See the plan <ArrowIcon /></Link>
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
        <p>{record.response.acknowledgement} {record.response.interpretation}</p>
        <strong>{record.response.recommendation}</strong>
        {!superseded && <Button variant="quiet" onClick={() => onCorrect(record)}><EditIcon />Correct this record</Button>}
      </div>
    </details>
  );
}

export function CheckinScreen() {
  const { checkins, derivedDay, selectedTrainingChoice, submitCheckin, undoLastCheckin } = useProduct();
  const [draft, setDraft] = useState("");
  const [latestId, setLatestId] = useState<string | null>(checkins.at(-1)?.id ?? null);
  const [correctionOf, setCorrectionOf] = useState<string | undefined>();
  const [modeNotice, setModeNotice] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const latest = useMemo(() => checkins.find((record) => record.id === latestId) ?? checkins.at(-1), [checkins, latestId]);
  const correctionTarget = useMemo(() => checkins.find((record) => record.id === correctionOf), [checkins, correctionOf]);
  const supersededIds = useMemo(() => new Set(checkins.flatMap((record) => record.correctionOf ? [record.correctionOf] : [])), [checkins]);
  const canSubmit = hasMeaningfulCheckinInput(draft);

  useEffect(() => {
    if (!latestId) return;
    const frame = window.requestAnimationFrame(() => responseRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [latestId]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    let record: CheckinRecord;
    try {
      record = submitCheckin(draft, correctionOf);
    } catch {
      setCorrectionOf(undefined);
      setModeNotice("That correction target is no longer available. Your wording is still here; review it before recording a new check-in.");
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

  const undo = () => {
    const removedId = checkins.at(-1)?.id;
    undoLastCheckin();
    setLatestId(checkins.at(-2)?.id ?? null);
    if (removedId && correctionOf === removedId) {
      setCorrectionOf(undefined);
      setDraft("");
    }
  };

  const showUnavailableMode = (label: string) => {
    setModeNotice(`${label} intake is not connected in this synthetic preview. Describe it in text; nothing will be uploaded or saved.`);
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
          <small>Synthetic session · no live monitoring</small>
        </aside>
      </header>

      <section className={styles.checkinPanel} aria-labelledby="composer-title">
        <div className={styles.composerIntro}>
          <Eyebrow>Check-in</Eyebrow>
          <h2 id="composer-title">What’s going on?</h2>
          <p>Use a declared demo prompt to exercise a plan change, or add context in your own words. Other wording is retained without health interpretation.</p>
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
            <span>Synthetic preview · session-only · nothing saved</span>
            <Button type="submit" disabled={!canSubmit}>Record check-in <ArrowIcon /></Button>
          </div>
        </form>
      </section>

      <div ref={responseRef} tabIndex={-1} className={styles.responseFocus}>
        <div className="sr-only" role="status" aria-live="polite">{latestId && latest ? latest.response.receipt : ""}</div>
        {latest && <LatestResponse record={latest} onUndo={undo} onCorrect={() => prepareCorrection(latest)} />}
      </div>

      <section className={styles.historySection} aria-labelledby="history-title">
        <div className={styles.historyHeading}>
          <div><Eyebrow>Today’s continuity</Eyebrow><h2 id="history-title">Check-in history</h2></div>
          <p>A chronological record, not a provider chat transcript.</p>
        </div>

        <div className={styles.historyList}>
          {checkins.slice().reverse().map((record) => <HistoryRecord key={record.id} record={record} superseded={supersededIds.has(record.id)} onCorrect={prepareCorrection} />)}
          {initialHistory.map((item) => (
            <article className={styles.initialHistory} key={item.time}>
              <div><time>{item.time}</time><span>{item.label}</span></div>
              <strong>{item.detail}</strong>
              <small>{item.receipt}</small>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
