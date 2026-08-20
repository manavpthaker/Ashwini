"use client";

import { useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import {
  evidenceDefinitions,
  mealReference,
  quietItems,
  reviews,
  routines,
  sources,
  systemQuestions,
  todayDecisions,
  type DecisionItem,
  type DomainId,
  type EvidenceStatus,
  type GateStatus,
} from "@/lib/demo-data";
import { movementReferences, muscleGroups, referenceProvenance } from "@/lib/learning";

type Surface = "today" | "capture" | "review" | "routines" | "library" | "data";
type CaptureMode = "meal" | "body" | "check-in" | "medication" | "document";
type LibraryMode = "movement" | "meals" | "evidence" | "medication";

const navigation: ReadonlyArray<{ id: Surface; label: string; detail: string }> = [
  { id: "today", label: "Today", detail: "Decisions, not noise" },
  { id: "capture", label: "Capture", detail: "The minimum useful record" },
  { id: "review", label: "Review", detail: "Comparable windows" },
  { id: "routines", label: "Routines", detail: "Small things to test" },
  { id: "library", label: "Library", detail: "Context, with sources" },
  { id: "data", label: "Data", detail: "Privacy and provenance" },
];

const surfaceHeadings: Record<Surface, { eyebrow: string; title: string }> = {
  today: { eyebrow: "Monday · June 23 · synthetic day", title: "What deserves your attention today?" },
  capture: { eyebrow: "Five capture modes · one private record", title: "Record reality without turning life into a study." },
  review: { eyebrow: "Five domains · evidence before verdict", title: "Compare like with like—or refuse the conclusion." },
  routines: { eyebrow: "Natural variation → micro-test → personal use", title: "Learn one small, reversible thing at a time." },
  library: { eyebrow: "Versioned reference assets", title: "Understand the task without leaving the decision." },
  data: { eyebrow: "Private topology · visible provenance", title: "Know where every record came from—and where it stays." },
};

const captureModes: ReadonlyArray<{ id: CaptureMode; label: string; detail: string }> = [
  { id: "meal", label: "Meal photo", detail: "Ranges, not precision" },
  { id: "body", label: "Body protocol", detail: "Weekly, standardized" },
  { id: "check-in", label: "Mood + focus", detail: "Brief, no interpretation" },
  { id: "medication", label: "Medication", detail: "Protected adherence" },
  { id: "document", label: "Document", detail: "Store, don’t diagnose" },
];

function statusClass(status: EvidenceStatus) {
  return status.toLowerCase().replaceAll(" ", "-");
}

function EvidencePill({ status }: { status: EvidenceStatus }) {
  return <span className={`evidence-pill ${statusClass(status)}`}>{status}</span>;
}

function GatePill({ gate }: { gate: GateStatus }) {
  return <span className={`gate-pill ${gate.toLowerCase()}`}><i aria-hidden="true" />Gate · {gate}</span>;
}

function DemoFlag() {
  return <div className="demo-flag"><i aria-hidden="true" /><span><strong>Full product prototype</strong>All records are synthetic. Nothing is connected, uploaded, or stored.</span></div>;
}

export function AshwiniWorkbench() {
  const [surface, setSurface] = useState<Surface>("today");

  const changeSurface = (next: Surface) => {
    setSurface(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="app-shell">
      <aside className="app-rail" aria-label="Ashwini navigation">
        <div>
          <button className="app-wordmark" onClick={() => changeSurface("today")}>ashwini<span>·</span></button>
          <p className="app-rail-label">Private health instrument</p>
        </div>

        <nav className="app-nav">
          {navigation.map((item) => (
            <button key={item.id} className={surface === item.id ? "active" : ""} aria-current={surface === item.id ? "page" : undefined} onClick={() => changeSurface(item.id)}>
              <i aria-hidden="true" />
              <span><strong>{item.label}</strong><small>{item.detail}</small></span>
            </button>
          ))}
        </nav>

        <div className="app-rail-purpose">
          <span>The operating rule</span>
          <p>Anything Ashwini says must change what happens next—or protect you from a false conclusion.</p>
        </div>
        <div className="app-rail-footer"><i /> Local-first direction<br />Private topology not yet built</div>
      </aside>

      <section className="app-workspace">
        <DemoFlag />
        <header className="app-header">
          <div><p className="app-eyebrow">{surfaceHeadings[surface].eyebrow}</p><h1>{surfaceHeadings[surface].title}</h1></div>
        </header>

        {surface === "today" && <Today goTo={changeSurface} />}
        {surface === "capture" && <Capture />}
        {surface === "review" && <Review />}
        {surface === "routines" && <Routines />}
        {surface === "library" && <Library />}
        {surface === "data" && <Data />}
      </section>
    </main>
  );
}

function Today({ goTo }: { goTo: (surface: Surface) => void }) {
  const [activeDecision, setActiveDecision] = useState(todayDecisions[0].id);
  const [choice, setChoice] = useState<string | null>(null);
  const decision = todayDecisions.find((item) => item.id === activeDecision) ?? todayDecisions[0];

  const chooseDecision = (id: string) => {
    setActiveDecision(id);
    setChoice(null);
  };

  return (
    <div className="surface-stack today-surface">
      <section className="purpose-hero" aria-labelledby="purpose-heading">
        <div className="purpose-copy">
          <p className="app-eyebrow">The product, in one sentence</p>
          <h2 id="purpose-heading">Your health data is everywhere. Ashwini turns it into a few next actions—and makes uncertainty impossible to miss.</h2>
          <p>It is an evidence router: record what happened, test whether the evidence is usable, then act, keep tracking, block a verdict, or hand the question to a professional.</p>
        </div>
        <EvidenceRouter />
      </section>

      <section className="today-layout">
        <div className="decision-queue">
          <div className="section-heading">
            <div><p className="app-eyebrow">Two interruptions</p><h2>Decisions that change today.</h2></div>
            <Badge tone="recorded">Everything else stays quiet</Badge>
          </div>
          <div className="decision-tabs" role="tablist" aria-label="Today’s decisions">
            {todayDecisions.map((item, index) => (
              <button key={item.id} role="tab" aria-selected={activeDecision === item.id} className={activeDecision === item.id ? "active" : ""} onClick={() => chooseDecision(item.id)}>
                <span>0{index + 1}</span><strong>{item.domain}</strong><small>{item.title}</small>
              </button>
            ))}
          </div>
          <DecisionCard decision={decision} choice={choice} setChoice={setChoice} />
        </div>

        <aside className="today-routines">
          <div className="section-heading compact-heading">
            <div><p className="app-eyebrow">In motion</p><h3>Learning routines</h3></div>
            <button onClick={() => goTo("routines")}>View all →</button>
          </div>
          {routines.slice(0, 2).map((routine) => (
            <article key={routine.id}>
              <EvidencePill status={routine.status} />
              <h4>{routine.title}</h4>
              <p>{routine.progress}</p>
              <div><span>Next review</span><strong>{routine.review.split(" · ")[0]}</strong></div>
            </article>
          ))}
          <div className="medication-separation"><i aria-hidden="true" /><p><strong>Medication stays separate.</strong> It can protect evidence quality, but it is never an experiment variable.</p></div>
        </aside>
      </section>

      <section className="quiet-section" aria-labelledby="quiet-heading">
        <div className="section-heading"><div><p className="app-eyebrow">Deliberately suppressed</p><h2 id="quiet-heading">What Ashwini stays quiet about.</h2></div><p>Visible here only to demonstrate the silence policy.</p></div>
        <div className="quiet-grid">
          {quietItems.map((item) => (
            <article key={item.title} className={statusClass(item.status)}>
              <div><EvidencePill status={item.status} /><span>{item.domain}</span></div>
              <h3>{item.title}</h3>
              <p>{item.summary}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function EvidenceRouter() {
  const inputs = ["Training", "Meal photos", "Medication", "Body protocol", "Mood + focus"];
  return (
    <div className="router" aria-label="Evidence router: sources pass through a quality gate and produce one of four bounded outcomes">
      <div className="router-inputs">
        <span className="router-label">Messy inputs</span>
        {inputs.map((input) => <b key={input}>{input}</b>)}
      </div>
      <div className="router-lines" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <div className="router-gate">
        <span className="router-label">Evidence gate</span>
        <strong>Clear</strong><strong>Caveated</strong><strong>Blocked</strong>
      </div>
      <div className="router-arrow" aria-hidden="true">→</div>
      <div className="router-outcomes">
        <span className="router-label">Only four outcomes</span>
        <b>Act</b><b>Track</b><b>No verdict</b><b>Route out</b>
      </div>
    </div>
  );
}

function DecisionCard({ decision, choice, setChoice }: { decision: DecisionItem; choice: string | null; setChoice: (choice: string) => void }) {
  return (
    <Card className="decision-card">
      <div className="decision-main">
        <div className="decision-meta"><EvidencePill status={decision.status} /><GatePill gate={decision.gate} /></div>
        <p className="decision-domain">{decision.domain}</p>
        <h3>{decision.title}</h3>
        <p className="decision-summary">{decision.summary}</p>

        <div className="decision-evidence">
          <span>Why now</span><p>{decision.whyNow}</p>
          <span>Evidence window</span><p>{decision.evidence}</p>
        </div>
        <div className="decision-actions">
          {decision.choices.map((item) => <Button key={item} variant={choice === item ? "primary" : "secondary"} onClick={() => setChoice(item)}>{item}</Button>)}
        </div>
        {choice && <div className="action-receipt" role="status"><strong>{choice}</strong><span>Saved only in this prototype state. {decision.expiry}.</span></div>}
      </div>
      <aside className="decision-boundary">
        <span>Ashwini refuses to claim</span>
        <p>{decision.refused}</p>
        <div><i aria-hidden="true" />Every choice includes “do nothing.”</div>
      </aside>
    </Card>
  );
}

function Capture() {
  const [mode, setMode] = useState<CaptureMode>("meal");
  const [saved, setSaved] = useState(false);
  const setCaptureMode = (next: CaptureMode) => { setMode(next); setSaved(false); };

  return (
    <div className="surface-stack capture-surface">
      <div className="surface-intro"><p>Ashwini asks for the smallest correction automation cannot safely invent. Each capture becomes a <strong>recorded fact first</strong>; interpretation happens only at the right review cadence.</p></div>
      <div className="mode-tabs" role="tablist" aria-label="Capture modes">
        {captureModes.map((item) => (
          <button key={item.id} role="tab" aria-selected={mode === item.id} className={mode === item.id ? "active" : ""} onClick={() => setCaptureMode(item.id)}>
            <strong>{item.label}</strong><small>{item.detail}</small>
          </button>
        ))}
      </div>

      {mode === "meal" && <MealCapture saved={saved} setSaved={setSaved} />}
      {mode === "body" && <BodyCapture saved={saved} setSaved={setSaved} />}
      {mode === "check-in" && <CheckInCapture saved={saved} setSaved={setSaved} />}
      {mode === "medication" && <MedicationCapture saved={saved} setSaved={setSaved} />}
      {mode === "document" && <DocumentCapture saved={saved} setSaved={setSaved} />}

      <section className="capture-contract">
        <div><span>Capture burden</span><strong>Ask only for what changes quality</strong><p>No diary for its own sake. Non-response is design feedback.</p></div>
        <div><span>Default status</span><strong>Recorded—not interpreted</strong><p>A capture cannot silently upgrade its epistemic status.</p></div>
        <div><span>Offline behavior</span><strong>Queue privately</strong><p>Target behavior only; encryption and conflict rules remain unresolved.</p></div>
      </section>
    </div>
  );
}

function CaptureReceipt({ saved, label }: { saved: boolean; label: string }) {
  if (!saved) return null;
  return <div className="capture-receipt" role="status"><EvidencePill status="Recorded" /><p><strong>{label}</strong> No real health data was stored. This synthetic record can become context, not an instant verdict.</p></div>;
}

function MealCapture({ saved, setSaved }: { saved: boolean; setSaved: (saved: boolean) => void }) {
  const [correction, setCorrection] = useState("Looks right");
  return (
    <section className="capture-stage meal-stage">
      <div className="capture-visual meal-visual" aria-label="Abstract meal photograph placeholder">
        <div className="plate"><i /><i /><i /></div>
        <span>synthetic meal image</span>
      </div>
      <div className="capture-panel">
        <div className="capture-title"><div><p className="app-eyebrow">Suggested identity</p><h2>{mealReference.name}</h2></div><Badge>{mealReference.confidence}</Badge></div>
        <div className="estimate-pair"><div><span>Educated range</span><strong>{mealReference.range}</strong></div><div><span>Protein range</span><strong>{mealReference.protein}</strong></div></div>
        <dl className="capture-facts"><div><dt>Visible</dt><dd>{mealReference.visible}</dd></div><div><dt>Cannot see</dt><dd>{mealReference.unknown}</dd></div></dl>
        <fieldset><legend>{mealReference.correction}</legend><div className="option-grid">{["Looks right", "Extra oil / ghee", "Portion differs", "Separate protein", "Not sure"].map((item) => <button key={item} className={correction === item ? "active" : ""} onClick={() => { setCorrection(item); setSaved(false); }}>{item}</button>)}</div></fieldset>
        <div className="capture-submit"><Button onClick={() => setSaved(true)}>Save meal range</Button><span>Selected correction: {correction}</span></div>
        <CaptureReceipt saved={saved} label={`${mealReference.name} range saved.`} />
      </div>
    </section>
  );
}

function BodyCapture({ saved, setSaved }: { saved: boolean; setSaved: (saved: boolean) => void }) {
  return (
    <section className="capture-stage body-stage">
      <div className="capture-visual body-visual" aria-label="Abstract standardized body-capture alignment guide">
        <div className="alignment-grid"><i className="head" /><i className="torso" /><i className="legs" /></div>
        <span>abstract alignment guide · no real photo</span>
      </div>
      <div className="capture-panel">
        <div className="capture-title"><div><p className="app-eyebrow">Weekly protocol · visual-0.1</p><h2>Front + side capture</h2></div><GatePill gate="Caveated" /></div>
        <ul className="protocol-checks"><li className="pass">Morning window matched</li><li className="pass">Camera height + distance matched</li><li className="pass">Neutral lighting detected</li><li className="fail">Side view alignment is outside tolerance</li></ul>
        <div className="capture-warning"><EvidencePill status="Unusable" /><p>The side view will remain in the record but cannot enter the 28-day comparison. Retake it now or save it as excluded.</p></div>
        <div className="capture-submit"><Button onClick={() => setSaved(true)}>Save with exclusion</Button><Button variant="secondary" onClick={() => setSaved(false)}>Retake side view</Button></div>
        <CaptureReceipt saved={saved} label="Capture set saved; side view excluded." />
      </div>
    </section>
  );
}

function CheckInCapture({ saved, setSaved }: { saved: boolean; setSaved: (saved: boolean) => void }) {
  const [focus, setFocus] = useState("4");
  const [mood, setMood] = useState("Neutral");
  return (
    <section className="capture-stage compact-stage">
      <div className="capture-panel wide-panel">
        <div className="capture-title"><div><p className="app-eyebrow">10 AM randomized prompt</p><h2>How available does your attention feel?</h2></div><Badge>Target burden · 8 sec</Badge></div>
        <fieldset><legend>Focus · not a diagnosis</legend><div className="scale-options">{["1", "2", "3", "4", "5"].map((item) => <button key={item} className={focus === item ? "active" : ""} onClick={() => { setFocus(item); setSaved(false); }}>{item}</button>)}</div><div className="scale-labels"><span>Hard to hold</span><span>Easy to direct</span></div></fieldset>
        <fieldset><legend>Mood context · optional</legend><div className="option-grid">{["Lower", "Neutral", "Higher", "Skip"].map((item) => <button key={item} className={mood === item ? "active" : ""} onClick={() => { setMood(item); setSaved(false); }}>{item}</button>)}</div></fieldset>
        <p className="boundary-note"><strong>Blackout window:</strong> no prompts after 8 PM. Responses stay blind until the declared review. No psychological cause or condition will be inferred.</p>
        <div className="capture-submit"><Button onClick={() => setSaved(true)}>Record check-in</Button><span>Focus {focus} · mood {mood}</span></div>
        <CaptureReceipt saved={saved} label="Check-in recorded." />
      </div>
    </section>
  );
}

function MedicationCapture({ saved, setSaved }: { saved: boolean; setSaved: (saved: boolean) => void }) {
  const [answer, setAnswer] = useState("Taken as scheduled");
  return (
    <section className="capture-stage compact-stage protected-stage">
      <div className="capture-panel wide-panel">
        <div className="capture-title"><div><p className="app-eyebrow">Protected lane · identity masked</p><h2>Prescription A · scheduled event</h2></div><EvidencePill status="Recorded" /></div>
        <fieldset><legend>What happened?</legend><div className="option-grid">{["Taken as scheduled", "Taken later", "Missed", "Not sure"].map((item) => <button key={item} className={answer === item ? "active" : ""} onClick={() => { setAnswer(item); setSaved(false); }}>{item}</button>)}</div></fieldset>
        <div className="protected-boundary"><span>Allowed</span><p>Scheduled/actual adherence, confirmed supply, pharmacy and clinician handoff details.</p><span>Never</span><p>Interaction checks, dose or timing changes, effectiveness judgments, or experimentation.</p></div>
        <div className="capture-submit"><Button onClick={() => setSaved(true)}>Save protected record</Button><span>{answer}</span></div>
        <CaptureReceipt saved={saved} label="Protected adherence event recorded." />
      </div>
    </section>
  );
}

function DocumentCapture({ saved, setSaved }: { saved: boolean; setSaved: (saved: boolean) => void }) {
  return (
    <section className="capture-stage compact-stage document-stage">
      <div className="document-preview"><span>PDF</span><strong>Dummy lab report</strong><small>2 pages · June 10</small><i aria-hidden="true" /></div>
      <div className="capture-panel">
        <div className="capture-title"><div><p className="app-eyebrow">Document record</p><h2>Lab report · clinician review pending</h2></div><EvidencePill status="Recorded" /></div>
        <dl className="capture-facts"><div><dt>Source</dt><dd>User-uploaded synthetic PDF</dd></div><div><dt>Use</dt><dd>Private record and clinician handoff</dd></div><div><dt>Interpretation</dt><dd>None in this prototype</dd></div></dl>
        <p className="boundary-note">Values may be transcribed only with source locators and quality status. Ashwini does not diagnose from, explain, or recommend treatment based on this report.</p>
        <div className="capture-submit"><Button onClick={() => setSaved(true)}>Record document</Button><Button variant="secondary">Prepare handoff</Button></div>
        <CaptureReceipt saved={saved} label="Document metadata recorded." />
      </div>
    </section>
  );
}

function Review() {
  const [domain, setDomain] = useState<DomainId>("training");
  const review = reviews.find((item) => item.id === domain) ?? reviews[0];
  return (
    <div className="surface-stack review-surface">
      <div className="surface-intro"><p>The same product language spans fast outcomes and slow systems, but the cadence changes. Training may be reviewed by session; body change requires standardized weeks; medication remains a record.</p></div>
      <div className="domain-tabs" role="tablist" aria-label="Review domains">
        {reviews.map((item) => <button key={item.id} role="tab" aria-selected={domain === item.id} className={domain === item.id ? "active" : ""} onClick={() => setDomain(item.id)}><span>{item.label}</span><EvidencePill status={item.status} /></button>)}
      </div>

      <section className="review-feature">
        <div className="review-summary">
          <div className="review-status"><EvidencePill status={review.status} /><GatePill gate={review.gate} /></div>
          <p className="app-eyebrow">{review.eyebrow}</p>
          <h2>{review.title}</h2>
          <p>{review.summary}</p>
          <div className="claim-pair"><div><span>Allowed conclusion</span><blockquote>{review.allowed}</blockquote></div><div><span>Refused upgrade</span><blockquote>{review.refused}</blockquote></div></div>
        </div>
        <aside className="review-window"><span>Review window</span><strong>{review.window}</strong><p>Every blocked record remains visible below. Exclusion happens before any summary is calculated.</p></aside>
      </section>

      <div className="review-metrics">{review.metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.note}</small></div>)}</div>

      <section className="review-timeline">
        <div className="section-heading"><div><p className="app-eyebrow">Inspectable record</p><h3>What entered—and what did not.</h3></div><Badge>Dummy values</Badge></div>
        {review.timeline.map((item) => <div key={`${item.date}-${item.label}`} className={item.state}><time>{item.date}</time><i aria-hidden="true" /><strong>{item.label}</strong><p>{item.detail}</p><span>{item.state === "blocked" ? "Excluded" : item.state}</span></div>)}
      </section>
    </div>
  );
}

function Routines() {
  const [active, setActive] = useState(routines[0].id);
  const routine = routines.find((item) => item.id === active) ?? routines[0];
  return (
    <div className="surface-stack routines-surface">
      <div className="surface-intro"><p>Ashwini learns from natural variation first. It promotes only low-risk, reversible, measurable questions into deliberate routines. Prescription medication, urgent symptoms, and irreversible choices are permanently ineligible.</p></div>
      <section className="routine-builder">
        <div className="routine-list">
          {routines.map((item) => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)}><EvidencePill status={item.status} /><strong>{item.title}</strong><span>{item.domain}</span><small>{item.progress}</small></button>)}
          <div className="ineligible-routine"><EvidencePill status="Route out" /><strong>Prescription change</strong><span>Permanently ineligible</span><p>A prescriber-controlled treatment cannot become an Ashwini experiment.</p></div>
        </div>
        <Card className="routine-detail">
          <div className="routine-detail-head"><div><EvidencePill status={routine.status} /><h2>{routine.title}</h2><p>{routine.progress}</p></div><span className="routine-number">{String(routines.findIndex((item) => item.id === routine.id) + 1).padStart(2, "0")}</span></div>
          <dl><div><dt>One behavior</dt><dd>{routine.behavior}</dd></div><div><dt>Target outcome</dt><dd>{routine.target}</dd></div><div><dt>Review point</dt><dd>{routine.review}</dd></div><div><dt>Evidence now</dt><dd>{routine.evidence}</dd></div><div><dt>Known confounds</dt><dd>{routine.confounds}</dd></div><div><dt>Stop boundary</dt><dd>{routine.stop}</dd></div></dl>
          <div className="routine-actions"><Button>{routine.status === "Noticed" ? "Choose a start date" : "Record today’s routine"}</Button><Button variant="secondary">Pause routine</Button><Button variant="quiet">Retire and keep history</Button></div>
        </Card>
      </section>
      <section className="learning-loop"><span>Notice</span><i>→</i><span>Label uncertainty</span><i>→</i><span>One small adjustment</span><i>→</i><span>Compare similar</span><i>→</i><span>Keep · reject · defer</span></section>
    </div>
  );
}

function Library() {
  const [mode, setMode] = useState<LibraryMode>("movement");
  return (
    <div className="surface-stack library-surface">
      <div className="surface-intro"><p>Reference material is educational context, not a feed and not an inference. Every asset exposes its version, provenance, review state, and safety boundary.</p></div>
      <div className="mode-tabs library-tabs" role="tablist" aria-label="Reference library categories">
        {(["movement", "meals", "evidence", "medication"] as const).map((item) => <button key={item} role="tab" aria-selected={mode === item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}><strong>{item === "movement" ? "Movement atlas" : item === "meals" ? "Meal references" : item === "evidence" ? "Evidence language" : "Medication boundary"}</strong><small>{item === "movement" ? "General education" : item === "meals" ? "Private recurring meals" : item === "evidence" ? "Nine visible statuses" : "Record + handoff only"}</small></button>)}
      </div>
      {mode === "movement" && <MovementLibrary />}
      {mode === "meals" && <MealLibrary />}
      {mode === "evidence" && <EvidenceLibrary />}
      {mode === "medication" && <MedicationLibrary />}
      <div className="provenance-strip"><span>Asset version</span><strong>{referenceProvenance.version}</strong><span>Review state</span><strong>{referenceProvenance.status}</strong><span>Boundary</span><p>{referenceProvenance.boundary}</p></div>
    </div>
  );
}

function MovementLibrary() {
  const [movement, setMovement] = useState(movementReferences[0].name);
  const item = movementReferences.find((entry) => entry.name === movement) ?? movementReferences[0];
  return (
    <section className="library-layout movement-library">
      <div className="reference-index">{movementReferences.map((entry) => <button key={entry.name} className={movement === entry.name ? "active" : ""} onClick={() => setMovement(entry.name)}><span>{entry.pattern}</span><strong>{entry.name}</strong><small>{entry.equipment}</small></button>)}</div>
      <Card className="movement-card">
        <div className="movement-head"><div><p className="app-eyebrow">{item.pattern} pattern</p><h2>{item.name}</h2></div><Badge>General education</Badge></div>
        <div className="muscle-map" aria-label="Abstract primary and supporting muscle group map">
          {muscleGroups.map((group) => <div key={group.id} className={item.primary.includes(group.id) ? "primary" : item.supporting.includes(group.id) ? "supporting" : ""}><i /><span>{group.name}</span><small>{item.primary.includes(group.id) ? "Primary" : item.supporting.includes(group.id) ? "Supporting" : group.region}</small></div>)}
        </div>
        <dl><div><dt>Equipment</dt><dd>{item.equipment}</dd></div><div><dt>General cue</dt><dd>{item.cue}</dd></div><div><dt>Boundary</dt><dd>Not a personal plan, form assessment, rehabilitation instruction, or declaration that this movement is safe for you.</dd></div></dl>
      </Card>
    </section>
  );
}

function MealLibrary() {
  return (
    <section className="library-layout">
      <div className="meal-reference-card"><span className="reference-kicker">Private meal · v1</span><div className="mini-plate"><i /><i /><i /></div><h2>{mealReference.name}</h2><p>A named recurring meal makes later capture easier. It does not make the estimate exact.</p></div>
      <Card className="reference-detail"><EvidencePill status="Recorded" /><h2>{mealReference.range}</h2><p className="big-subline">{mealReference.protein} · {mealReference.confidence}</p><dl><div><dt>Usable for</dt><dd>Weekly trends, pattern learning, and a private meal shortcut.</dd></div><div><dt>Still unknown</dt><dd>{mealReference.unknown}.</dd></div><div><dt>Highest-value prompt</dt><dd>{mealReference.correction}</dd></div><div><dt>Forbidden claim</dt><dd>This image contains an exact calorie or protein amount.</dd></div></dl></Card>
    </section>
  );
}

function EvidenceLibrary() {
  return <section className="evidence-grid">{evidenceDefinitions.map((item, index) => <article key={item.status}><span>{String(index).padStart(2, "0")}</span><EvidencePill status={item.status} /><strong>{item.action}</strong><p>{item.meaning}</p></article>)}</section>;
}

function MedicationLibrary() {
  return (
    <section className="medication-library">
      <div><p className="app-eyebrow">Allowed reference asset</p><h2>Prescription A</h2><dl><div><dt>Identity</dt><dd>User-entered · masked in demo</dd></div><div><dt>Schedule</dt><dd>Existing prescription schedule</dd></div><div><dt>Supply</dt><dd>Last confirmed June 8</dd></div><div><dt>Handoff</dt><dd>Clinician + pharmacy details</dd></div></dl></div>
      <div className="never-panel"><EvidencePill status="Route out" /><h2>A record—not a medication engine.</h2><p>Ashwini never checks interactions, proposes a dose or timing change, evaluates effectiveness, or makes a prescription part of a personal experiment.</p><Button variant="secondary">Prepare clinician handoff</Button></div>
    </section>
  );
}

function Data() {
  return (
    <div className="surface-stack data-surface">
      <div className="surface-intro"><p>This screen is intentionally honest about the gap between the intended private architecture and a working system. The data is synthetic; the topology below is the approved direction, not deployed infrastructure.</p></div>
      <section className="topology" aria-labelledby="topology-heading">
        <div className="section-heading"><div><p className="app-eyebrow">No public ingress</p><h2 id="topology-heading">Capture here. Resolve privately. Render where useful.</h2></div><Badge tone="warning">Direction · not deployed</Badge></div>
        <div className="topology-flow"><article><span>01 · Capture</span><strong>iPhone</strong><p>Photos, confirmations, brief prompts, native medication reminders.</p></article><i aria-hidden="true">→</i><article className="canonical"><span>02 · Canonical</span><strong>Private Mac mini</strong><p>Encrypted source record, evidence gates, scheduled review, audit history.</p></article><i aria-hidden="true">→</i><article><span>03 · Render</span><strong>Ashwini + Obsidian</strong><p>Decisions, review records, handoffs, and versioned context assets.</p></article></div>
      </section>

      <section className="source-ledger">
        <div className="section-heading"><div><p className="app-eyebrow">Source ledger</p><h2>Every claim can trace its inputs.</h2></div><Badge>All dummy sources</Badge></div>
        <div className="source-table" role="table" aria-label="Synthetic source ledger">
          <div className="source-row source-header" role="row"><span>Source</span><span>Use</span><span>Freshness</span><span>State</span><span>Boundary</span></div>
          {sources.map((source) => <div className="source-row" role="row" key={source.name}><div><strong>{source.name}</strong><small>{source.owner}</small></div><span>{source.kind}</span><time>{source.freshness}</time><span className={`source-state ${source.state.toLowerCase().replaceAll(" ", "-")}`}>{source.state}</span><p>{source.note}</p></div>)}
        </div>
      </section>

      <section className="unresolved-section">
        <div><p className="app-eyebrow">Privacy gate</p><h2>Personal ingestion stays blocked until these are real.</h2><p>The PRD makes privacy a product property. A local-looking interface is not enough.</p></div>
        <ol>{systemQuestions.map((question, index) => <li key={question}><span>0{index + 1}</span><strong>{question}</strong><em>Unresolved</em></li>)}</ol>
      </section>
    </div>
  );
}
