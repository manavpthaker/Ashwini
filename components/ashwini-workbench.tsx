"use client";

import { useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import {
  comparisonRows,
  demoSessions,
  evidenceLadder,
  sourcePlan,
  storyMoments,
  type StoryMoment,
  type StoryMomentId,
} from "@/lib/demo-story";

type Surface = "today" | "capture" | "review" | "evidence";
type DecisionChoice = "Keep for next block" | "Repeat the comparison" | "Retire the routine";
type MealAnswer = "Followed" | "Not followed";
type SessionAnswer = "Completed as planned" | "Adjusted or stopped";

const nav: ReadonlyArray<{ id: Surface; label: string; detail: string }> = [
  { id: "today", label: "Today", detail: "The decision" },
  { id: "capture", label: "Capture", detail: "The burden" },
  { id: "review", label: "Review", detail: "The comparison" },
  { id: "evidence", label: "Evidence", detail: "The method" },
];

const headings: Record<Surface, { eyebrow: string; title: string }> = {
  today: { eyebrow: "Day 30 / open decision", title: "One decision, not another dashboard." },
  capture: { eyebrow: "Practicality / two confirmations", title: "The burden has to earn its place." },
  review: { eyebrow: "Thirty days / twelve sessions", title: "Every conclusion keeps its exclusions." },
  evidence: { eyebrow: "Decision record / inspectable", title: "Trust comes from visible restraint." },
};

export function AshwiniWorkbench() {
  const [surface, setSurface] = useState<Surface>("today");
  const [momentId, setMomentId] = useState<StoryMomentId>("decision");
  const [decision, setDecision] = useState<DecisionChoice | null>(null);
  const [mealAnswer, setMealAnswer] = useState<MealAnswer | null>(null);
  const [sessionAnswer, setSessionAnswer] = useState<SessionAnswer | null>(null);
  const [sampleSaved, setSampleSaved] = useState(false);
  const moment = storyMoments.find((item) => item.id === momentId) ?? storyMoments[3];

  const changeSurface = (next: Surface) => {
    setSurface(next);
    window.scrollTo({ top: 0 });
  };

  return (
    <main className="app-shell">
      <aside className="app-rail" aria-label="ashwini demo navigation">
        <button className="app-wordmark" onClick={() => changeSurface("today")}>ashwini<span>·</span></button>
        <p className="app-rail-label">A private evidence router</p>
        <div className="scenario-stamp"><span>Preloaded scenario</span><strong>30 days · one question</strong></div>
        <nav className="app-nav">
          {nav.map((item) => (
            <button key={item.id} className={surface === item.id ? "active" : ""} aria-current={surface === item.id ? "page" : undefined} onClick={() => changeSurface(item.id)}>
              <i aria-hidden="true" />
              <span><strong>{item.label}</strong><small>{item.detail}</small></span>
            </button>
          ))}
        </nav>
        <div className="app-rail-footer"><i /> Synthetic data<br />Nothing connected or stored</div>
      </aside>

      <section className="app-workspace">
        <header className="app-header">
          <div><p className="app-eyebrow">{headings[surface].eyebrow}</p><h1>{headings[surface].title}</h1></div>
          <Badge tone="warning">Demo data · no live sources</Badge>
        </header>

        {surface === "today" && <Today moment={moment} momentId={momentId} setMomentId={setMomentId} decision={decision} setDecision={setDecision} />}
        {surface === "capture" && <Capture mealAnswer={mealAnswer} setMealAnswer={setMealAnswer} sessionAnswer={sessionAnswer} setSessionAnswer={setSessionAnswer} sampleSaved={sampleSaved} setSampleSaved={setSampleSaved} />}
        {surface === "review" && <Review setMomentId={setMomentId} goToday={() => changeSurface("today")} />}
        {surface === "evidence" && <Evidence />}
      </section>
    </main>
  );
}

function Today({ moment, momentId, setMomentId, decision, setDecision }: {
  moment: StoryMoment;
  momentId: StoryMomentId;
  setMomentId: (id: StoryMomentId) => void;
  decision: DecisionChoice | null;
  setDecision: (choice: DecisionChoice) => void;
}) {
  const currentIndex = storyMoments.findIndex((item) => item.id === momentId);
  const nextMoment = storyMoments[currentIndex + 1];

  return (
    <div className="surface-stack demo-today">
      <section className="story-switcher" aria-labelledby="story-heading">
        <div className="section-heading compact-heading"><div><p className="app-eyebrow">The 30-day story</p><h2 id="story-heading">Watch the language change as evidence earns it.</h2></div><Badge>{moment.date}</Badge></div>
        <div className="story-moments">
          {storyMoments.map((item) => (
            <button key={item.id} className={momentId === item.id ? `active ${item.id}` : item.id} aria-pressed={momentId === item.id} onClick={() => setMomentId(item.id)}>
              <span>Day {item.day}</span><strong>{item.status}</strong><small>{item.date}</small>
            </button>
          ))}
        </div>
      </section>

      <Card className={`decision-card moment-${moment.id}`}>
        <div className="decision-main">
          <div className="decision-status"><Badge tone={moment.id === "blocked" ? "warning" : moment.id === "decision" ? "recorded" : "neutral"}>{moment.status}</Badge><span>Day {moment.day} of 30</span></div>
          <p className="decision-label">The only interruption</p>
          <h2>{moment.heading}</h2>
          <p className="decision-body">{moment.body}</p>
          <div className="decision-evidence"><span>Why this language is allowed</span><p>{moment.evidence}</p></div>

          {moment.id === "decision" ? (
            <div className="decision-actions" aria-label="Decision choices">
              {(["Keep for next block", "Repeat the comparison", "Retire the routine"] as const).map((choice) => <Button key={choice} variant={decision === choice ? "primary" : "secondary"} onClick={() => setDecision(choice)}>{choice}</Button>)}
            </div>
          ) : nextMoment ? (
            <Button className="story-next" onClick={() => setMomentId(nextMoment.id)}>Continue to Day {nextMoment.day} →</Button>
          ) : null}

          {decision && moment.id === "decision" && <div className="decision-receipt" role="status"><strong>{decision}</strong><span>Logged only inside this demo. Scope: afternoon sessions. Review again after the next block.</span></div>}
        </div>
        <aside className="decision-guardrails">
          <div><span>What changes next</span><p>{moment.next}</p></div>
          <div><span>What Ashwini refuses to claim</span><p>{moment.refused}</p></div>
        </aside>
      </Card>

      <EvidenceTrace />

      <section className="outcome-grid" aria-label="Thirty day result summary">
        <Card><span>Observed</span><strong>12</strong><p>Afternoon sessions retained in the record</p></Card>
        <Card><span>Comparable</span><strong>10</strong><p>Sessions allowed into the result</p></Card>
        <Card className="blocked-stat"><span>Blocked</span><strong>2</strong><p>Excluded before the comparison</p></Card>
        <Card className="quiet-stat"><span>Daily dashboard</span><strong>0</strong><p>Only the open decision interrupts</p></Card>
      </section>
    </div>
  );
}

function EvidenceTrace() {
  return (
    <section className="evidence-trace" aria-labelledby="trace-heading">
      <div className="trace-copy"><p className="app-eyebrow">Evidence trace</p><h3 id="trace-heading">Twelve sessions. Two do not get a vote.</h3><p>Each mark preserves the routine, outcome, and exclusion status. Hover or focus for the exact record.</p></div>
      <ol>
        {demoSessions.map((session) => (
          <li key={session.day} className={`trace-session ${session.outcome}`} tabIndex={0} aria-label={`Day ${session.day}, ${session.routine}, ${session.note}${session.confound ? `, blocked by ${session.confound}` : ""}`}>
            <span className="trace-day">D{String(session.day).padStart(2, "0")}</span>
            <i aria-hidden="true" />
            <strong>{session.routine === "followed" ? "Meal" : "No meal"}</strong>
            <small>{session.outcome === "met" ? "Target met" : session.outcome === "adjusted" ? "Adjusted" : "Blocked"}</small>
            <div className="trace-tooltip" role="tooltip"><b>{session.date}</b><span>{session.note}</span>{session.confound && <em>{session.confound}</em>}</div>
          </li>
        ))}
      </ol>
      <div className="trace-legend"><span><i className="met" />Target met</span><span><i className="adjusted" />Adjusted</span><span><i className="blocked" />Excluded before review</span></div>
    </section>
  );
}

function Capture({ mealAnswer, setMealAnswer, sessionAnswer, setSessionAnswer, sampleSaved, setSampleSaved }: {
  mealAnswer: MealAnswer | null;
  setMealAnswer: (answer: MealAnswer) => void;
  sessionAnswer: SessionAnswer | null;
  setSessionAnswer: (answer: SessionAnswer) => void;
  sampleSaved: boolean;
  setSampleSaved: (saved: boolean) => void;
}) {
  const chooseMeal = (answer: MealAnswer) => { setMealAnswer(answer); setSampleSaved(false); };
  const chooseSession = (answer: SessionAnswer) => { setSessionAnswer(answer); setSampleSaved(false); };

  return (
    <div className="surface-stack capture-demo">
      <div className="surface-intro"><p className="app-eyebrow">Designed interaction target</p><h2>Two confirmations on a training day. Nothing on a rest day.</h2><p>The usefulness case fails if the comparison requires a diary. This scenario assumes planned sources supply the context and asks the user only for facts automation cannot safely invent.</p></div>

      <div className="capture-demo-grid">
        <Card className="sample-capture">
          <div className="sample-topline"><div><p className="app-eyebrow">Sample session / May 21</p><h3>Afternoon training</h3></div><Badge>Target burden · ≈12 sec</Badge></div>
          <fieldset><legend>Was the familiar pre-training meal followed?</legend><div className="choice-pair"><Button variant={mealAnswer === "Followed" ? "primary" : "secondary"} onClick={() => chooseMeal("Followed")}>Yes, followed</Button><Button variant={mealAnswer === "Not followed" ? "primary" : "secondary"} onClick={() => chooseMeal("Not followed")}>No, intentional miss</Button></div></fieldset>
          <fieldset><legend>Was the planned training completed?</legend><div className="choice-pair"><Button variant={sessionAnswer === "Completed as planned" ? "primary" : "secondary"} onClick={() => chooseSession("Completed as planned")}>Completed as planned</Button><Button variant={sessionAnswer === "Adjusted or stopped" ? "primary" : "secondary"} onClick={() => chooseSession("Adjusted or stopped")}>Adjusted or stopped</Button></div></fieldset>
          <div className="sample-save"><Button disabled={!mealAnswer || !sessionAnswer} onClick={() => setSampleSaved(true)}>Save two confirmations</Button><span>Sleep and schedule context would arrive from verified sources.</span></div>
          {sampleSaved && <div className="sample-receipt" role="status"><strong>Sample recorded.</strong><span>No real health data was stored. In the product, this becomes a Recorded fact—not a verdict.</span></div>}
        </Card>

        <aside className="burden-card"><p className="app-eyebrow">The practical contract</p><h3>No daily compliance theater.</h3><dl><div><dt>Rest days</dt><dd>No prompt</dd></div><div><dt>Training days</dt><dd>Two confirmations</dd></div><div><dt>Unusual context</dt><dd>One exception prompt</dd></div><div><dt>Interpretation</dt><dd>Only at the declared review</dd></div></dl><p className="burden-caveat">This is the burden target the demo proposes. It has not yet been validated with real integrations or 30 days of use.</p></aside>
      </div>

      <section className="source-plan" aria-labelledby="source-plan-heading"><div className="section-heading"><div><p className="app-eyebrow">Source plan</p><h3 id="source-plan-heading">What should be automatic—and what must stay yours.</h3></div><Badge tone="warning">None connected</Badge></div><div className="source-table" role="table" aria-label="Scenario source and burden plan">{sourcePlan.map((source) => <div className="source-row" role="row" key={source.name}><strong role="cell">{source.name}</strong><span role="cell">{source.owner}</span><span role="cell">{source.burden}</span><Badge tone={source.state === "Not interpreted" ? "recorded" : source.state === "Demo interaction" ? "neutral" : "warning"}>{source.state}</Badge></div>)}</div></section>
    </div>
  );
}

function Review({ setMomentId, goToday }: { setMomentId: (id: StoryMomentId) => void; goToday: () => void }) {
  const inspectMoment = (id: StoryMomentId) => { setMomentId(id); goToday(); };
  return (
    <div className="surface-stack review-demo">
      <div className="surface-intro"><p className="app-eyebrow">Pre-declared target</p><h2>Complete the planned afternoon session without an unplanned reduction.</h2><p>This is a comparison of routine reliability, not proof that the meal caused performance. Two contaminated sessions remain visible and are excluded before any rates are calculated.</p></div>

      <Card className="comparison-card"><div className="section-heading"><div><p className="app-eyebrow">Clean-window comparison</p><h3>What the decision is based on.</h3></div><Badge tone="recorded">Personally useful</Badge></div><div className="comparison-table" role="table" aria-label="Pre-training routine comparison"><div className="comparison-row table-header" role="row"><span role="columnheader">Condition</span><span role="columnheader">Comparable</span><span role="columnheader">Target met</span><span role="columnheader">Allowed language</span></div>{comparisonRows.map((row) => <div className="comparison-row" role="row" key={row.condition}><strong role="cell">{row.condition}</strong><span role="cell">{row.comparable || "—"}</span><span role="cell">{row.condition === "Confounded" ? "—" : `${row.targetMet} of ${row.comparable}`}</span><span role="cell">{row.language}</span></div>)}</div></Card>

      <div className="review-columns">
        <section className="story-ledger" aria-labelledby="ledger-heading"><div className="section-heading"><div><p className="app-eyebrow">Language ledger</p><h3 id="ledger-heading">The conclusion changes four times.</h3></div></div>{storyMoments.map((item) => <button key={item.id} onClick={() => inspectMoment(item.id)}><time>Day {item.day}</time><div><Badge tone={item.id === "blocked" ? "warning" : item.id === "decision" ? "recorded" : "neutral"}>{item.status}</Badge><strong>{item.heading}</strong><span>{item.evidence}</span></div><i aria-hidden="true">→</i></button>)}</section>
        <aside className="excluded-card"><p className="app-eyebrow">Excluded before calculation</p><h3>The discarded data is part of the result.</h3><div><span>Day 9</span><strong>Severe sleep debt</strong><p>Meal followed. Session retained, but it cannot vote.</p></div><div><span>Day 26</span><strong>Travel and adherence gap</strong><p>The adherence record is a confound only. Medication is not evaluated.</p></div><p className="excluded-rule">User overrides: none. Threshold version: scenario-0.1.</p></aside>
      </div>
    </div>
  );
}

function Evidence() {
  return (
    <div className="surface-stack evidence-demo">
      <div className="surface-intro"><p className="app-eyebrow">Inspectable decision object</p><h2>The answer includes the reasons it may be wrong.</h2><p>The product earns trust by preserving the question, source quality, excluded windows, scope, expiry, and user choice—not by displaying more measurements.</p></div>

      <div className="evidence-layout">
        <Card className="decision-object"><div className="section-heading"><div><p className="app-eyebrow">Decision / demo-0001</p><h3>Keep the meal routine?</h3></div><Badge tone="recorded">Ready</Badge></div><dl><div><dt>Question</dt><dd>Does a familiar meal 60–90 minutes before afternoon training support planned completion?</dd></div><div><dt>Target</dt><dd>Complete planned work without unplanned reduction.</dd></div><div><dt>Window</dt><dd>May 4–June 2 · 30 days</dd></div><div><dt>Sources</dt><dd>12 synthetic session records · no live integrations</dd></div><div><dt>Gate</dt><dd>10 clear · 0 caveated · 2 blocked</dd></div><div><dt>Scope</dt><dd>This person · this routine · afternoon sessions · this window</dd></div><div><dt>Expiry</dt><dd>Review after the next training block or material routine change.</dd></div></dl></Card>

        <aside className="allowed-language"><p className="app-eyebrow">Allowed sentence</p><blockquote>“In this 30-day scenario, afternoon sessions with the routine were more reliably completed under comparable conditions.”</blockquote><p className="app-eyebrow">Forbidden upgrade</p><blockquote className="forbidden">“This meal improves workout performance.”</blockquote><p>The first is a bounded personal comparison. The second invents causality and generalizes beyond the evidence.</p></aside>
      </div>

      <section className="evidence-ladder" aria-labelledby="ladder-heading"><div className="section-heading"><div><p className="app-eyebrow">Evidence ladder</p><h3 id="ladder-heading">Each rung must be earned.</h3></div></div><ol>{evidenceLadder.map((item) => <li key={item.status}><span>Day {item.day}</span><i aria-hidden="true" /><div><strong>{item.status}</strong><p>{item.meaning}</p></div></li>)}</ol></section>

      <Card className="reality-check"><div><p className="app-eyebrow">What this demo proves</p><h3>The decision experience can be made legible.</h3><p>It shows the intended value, burden, refusal behavior, and final choice using synthetic data.</p></div><div><p className="app-eyebrow">What it does not prove</p><h3>The system can collect or judge this reliably.</h3><p>Real value still depends on source verification, acceptable burden, versioned confound thresholds, privacy controls, and a genuinely useful first 30-day routine.</p></div></Card>
    </div>
  );
}
