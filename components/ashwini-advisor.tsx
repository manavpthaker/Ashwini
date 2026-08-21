"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Badge, Button } from "@/components/ui";
import { Data, Library, Review, Routines } from "@/components/ashwini-workbench";
import {
  evidenceConnectors,
  initialConversation,
  middayPriorities,
  todaySchedule,
  type AdvisorMessage,
} from "@/lib/demo-data";

type Surface = "now" | "conversation" | "plan" | "review" | "evidence" | "data";

const navigation: ReadonlyArray<{ id: Surface; label: string; detail: string }> = [
  { id: "now", label: "Now", detail: "Friday · 12:18 PM" },
  { id: "conversation", label: "Conversation", detail: "One place for every input" },
  { id: "plan", label: "Plan", detail: "2 active routines" },
  { id: "review", label: "Review", detail: "2 ready · 1 blocked" },
  { id: "evidence", label: "Evidence", detail: "Sources + personal learning" },
  { id: "data", label: "Data", detail: "9 synthetic sources" },
];

const surfaceHeadings: Record<Surface, { eyebrow: string; title: string; context: string }> = {
  now: { eyebrow: "Friday, June 27 · 12:18 PM", title: "Midday", context: "Training in 4h 12m" },
  conversation: { eyebrow: "One continuous intake", title: "Conversation", context: "6 inputs routed today" },
  plan: { eyebrow: "Working plan", title: "Plan", context: "2 active · 1 candidate" },
  review: { eyebrow: "May 25–June 23", title: "Review", context: "5 domains · 2 ready" },
  evidence: { eyebrow: "Research + personal learning", title: "Evidence", context: "Examine adapter ready" },
  data: { eyebrow: "Sources and controls", title: "Data & privacy", context: "9 sources · synthetic workspace" },
};

const quickPrompts = [
  "I ate lunch",
  "I feel flat",
  "My shoulder hurts",
  "Can I add creatine?",
] as const;

function replyFor(input: string): Omit<AdvisorMessage, "id" | "role" | "time"> {
  const normalized = input.toLowerCase();

  if (/chest pain|can.?t breathe|cannot breathe|face droop|one-sided weakness/.test(normalized)) {
    return {
      text: "This is not a wait-and-see item. Stop the current plan and seek urgent medical help now. I’ve kept your wording and the time so you can show exactly what you reported.",
      receipt: "Urgent route · original wording retained",
      kind: "route",
    };
  }

  if (/shoulder|knee|back|pain|hurt|injury/.test(normalized)) {
    return {
      text: "I’d remove the painful movement from today’s session rather than test it under load. Tell me whether this is new, worsening, or limiting normal movement; that decides whether I swap the session or prepare a clinician/PT handoff.",
      receipt: "Training recommendation · symptom follow-up needed",
      kind: "question",
    };
  }

  if (/creatine|supplement|magnesium|vitamin|ashwagandha/.test(normalized)) {
    return {
      text: "Creatine monohydrate is worth evaluating for your training goal, but I would not add it until the current supplement and medication list has a live safety check. I’ve queued an Examine Connect interaction query; this dummy workspace has no authorized key, so there is no interaction result yet.",
      receipt: "Research candidate · safety check queued",
      kind: "recommendation",
    };
  }

  if (/lunch|ate|meal|dal|rice|sandwich|salad|photo/.test(normalized)) {
    return {
      text: "Lunch is logged as a medium-confidence meal estimate. My working range is 540–720 kcal and 26–38 g protein. If there wasn’t a clear protein side, add the familiar yogurt, egg, or soy fallback; otherwise you’re set until the 3:45 training check.",
      receipt: "Nutrition record + afternoon plan updated",
      kind: "recommendation",
    };
  }

  if (/flat|tired|exhausted|low energy|poor sleep|sleepy/.test(normalized)) {
    return {
      text: "That changes the training call. With short sleep already in the record, I’d cap today at the reduced-volume version unless energy clearly rebounds after lunch. I’ll ask once at 3:45 instead of making you decide now.",
      receipt: "Training plan · reduced volume favored",
      kind: "recommendation",
    };
  }

  if (/prescription|medication|dose|refill|pharmacy/.test(normalized)) {
    return {
      text: "I recorded this in the protected medication lane. I can track adherence, supply, refill risk, and cited supplement interactions. Any prescription change or drug–drug question will become a pharmacist or prescriber handoff.",
      receipt: "Protected medication record",
      kind: "record",
    };
  }

  return {
    text: "I recorded that as context. My current read is that it does not change lunch or the 4:30 session yet. What matters most here: how you feel, what you did, or what you want me to help decide?",
    receipt: "Context retained · one follow-up",
    kind: "question",
  };
}

function DemoFlag() {
  return <div className="demo-flag"><i aria-hidden="true" /><span><strong>Demo workspace</strong>Synthetic month</span></div>;
}

export function AshwiniAdvisor() {
  const [surface, setSurface] = useState<Surface>("now");
  const [messages, setMessages] = useState<AdvisorMessage[]>([...initialConversation]);
  const [lunchLogged, setLunchLogged] = useState(false);

  const changeSurface = (next: Surface) => {
    setSurface(next);
    window.scrollTo({ top: 0 });
  };

  const sendMessage = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const stamp = "12:19 PM";
    const userMessage: AdvisorMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      time: stamp,
      text: trimmed,
      receipt: "Input received",
      kind: "record",
    };
    const reply = replyFor(trimmed);
    const advisorMessage: AdvisorMessage = {
      ...reply,
      id: `ashwini-${Date.now() + 1}`,
      role: "ashwini",
      time: stamp,
    };

    if (/lunch|ate|meal|dal|rice|sandwich|salad|photo/i.test(trimmed)) setLunchLogged(true);
    setMessages((current) => [...current, userMessage, advisorMessage]);
  };

  return (
    <main className="app-shell advisor-shell">
      <aside className="app-rail" aria-label="Ashwini navigation">
        <div>
          <button className="app-wordmark" onClick={() => changeSurface("now")}>ashwini<span>·</span></button>
          <p className="app-rail-label">Personal health advisor</p>
        </div>

        <nav className="app-nav">
          {navigation.map((item) => (
            <button key={item.id} className={surface === item.id ? "active" : ""} aria-current={surface === item.id ? "page" : undefined} onClick={() => changeSurface(item.id)}>
              <i aria-hidden="true" />
              <span><strong>{item.label}</strong><small>{item.detail}</small></span>
            </button>
          ))}
        </nav>

        <div className="rail-advisor-state">
          <span><i aria-hidden="true" /> Guidance active</span>
          <p>Food, training, recovery, habits, and low-risk recommendations.</p>
          <small>Clinical decisions route to specialists.</small>
        </div>

        <div className="rail-workspace">
          <div className="rail-avatar" aria-hidden="true">MP</div>
          <div><strong>Personal workspace</strong><span>Month 2 · day 5</span></div>
        </div>
        <div className="app-rail-footer"><i /> Last dummy sync · 12:18 PM<br />9 sources in this workspace</div>
      </aside>

      <section className="app-workspace">
        <header className="app-header">
          <div><p className="app-eyebrow">{surfaceHeadings[surface].eyebrow}</p><h1>{surfaceHeadings[surface].title}</h1></div>
          <div className="header-utilities"><span>{surface === "conversation" && messages.length > initialConversation.length ? "7 inputs routed today" : surfaceHeadings[surface].context}</span><DemoFlag /></div>
        </header>

        {surface === "now" && <NowSurface messages={messages} lunchLogged={lunchLogged} goTo={changeSurface} sendMessage={sendMessage} />}
        {surface === "conversation" && <ConversationSurface messages={messages} lunchLogged={lunchLogged} sendMessage={sendMessage} goTo={changeSurface} />}
        {surface === "plan" && <Routines />}
        {surface === "review" && <Review />}
        {surface === "evidence" && <Library />}
        {surface === "data" && <Data />}
      </section>
    </main>
  );
}

function NowSurface({ messages, lunchLogged, goTo, sendMessage }: { messages: AdvisorMessage[]; lunchLogged: boolean; goTo: (surface: Surface) => void; sendMessage: (text: string) => void }) {
  return (
    <div className="surface-stack now-surface">
      <section className="midday-brief" aria-labelledby="midday-title">
        <div className="time-block">
          <span>12:18</span>
          <strong>PM</strong>
          <small>Friday · midday</small>
        </div>
        <div className="brief-call">
          <p className="app-eyebrow">Ashwini’s call</p>
          <h2 id="midday-title">{lunchLogged ? "Lunch is covered. Leave the session alone until 3:45." : "Eat now. Keep the 4:30 session, but earn the full volume later."}</h2>
          <p>{lunchLogged ? "Your meal is in the record. Short sleep is the only active caution, so I’ll use energy and shoulder status for the final volume check." : "Breakfast and medication are recorded. Lunch is the missing input. Short sleep matters, but your energy and shoulder check are currently good enough to keep training on the board."}</p>
          <div className="brief-basis">
            <span>Based on</span>
            <strong>6h 18m sleep</strong>
            <strong>Energy normal</strong>
            <strong>Shoulder quiet</strong>
            <strong>Training at 4:30</strong>
          </div>
        </div>
        <div className="brief-countdown">
          <span>Next commitment</span>
          <strong>4h 12m</strong>
          <p>Upper-body training<br />Volume check at 3:45</p>
        </div>
      </section>

      <section className="now-grid">
        <div className="now-priorities">
          <div className="section-heading compact-heading">
            <div><p className="app-eyebrow">Friday shift brief</p><h3>What matters next</h3></div>
            <Badge>{lunchLogged ? "1 completed · 2 queued" : "1 now · 2 queued"}</Badge>
          </div>
          <div className="priority-list">
            {middayPriorities.map((item, index) => {
              const completed = item.id === "lunch" && lunchLogged;
              return (
                <article key={item.id} className={`${item.state} ${completed ? "completed" : ""}`}>
                  <span className="priority-number">0{index + 1}</span>
                  <div><span>{completed ? "Done" : item.time} · {item.domain}</span><h4>{completed ? "Lunch recorded. Afternoon plan updated." : item.title}</h4><p>{completed ? "No more nutrition input is needed until dinner unless the meal estimate needs a correction." : item.detail}</p></div>
                  <Button variant={item.state === "now" && !completed ? "primary" : "secondary"} onClick={() => goTo("conversation")}>{completed ? "View record" : item.action}</Button>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="now-dayline">
          <div className="section-heading compact-heading"><div><p className="app-eyebrow">Already known</p><h3>Friday so far</h3></div><span>Live context</span></div>
          <ol>
            {todaySchedule.map((item) => {
              const dynamicLunch = item.title === "Lunch is missing" && lunchLogged;
              return (
                <li key={`${item.time}-${item.title}`} className={dynamicLunch ? "done" : item.state}>
                  <time>{item.time}</time><i aria-hidden="true" />
                  <div><span>{item.domain}</span><strong>{dynamicLunch ? "Lunch recorded" : item.title}</strong><p>{dynamicLunch ? "Meal range + protein estimate saved" : item.detail}</p></div>
                </li>
              );
            })}
          </ol>
        </aside>
      </section>

      <section className="now-conversation">
        <div className="conversation-invite">
          <p className="app-eyebrow">One place for every input</p>
          <h2>Don’t decide where it belongs. Just tell me.</h2>
          <p>Food, sleep, training, medication, symptoms, a photo, a document, or a question all begin here. Ashwini structures the record and tells you what it changed.</p>
        </div>
        <div>
          <QuickComposer onSend={sendMessage} />
          <button className="open-conversation" onClick={() => goTo("conversation")}>Open today’s full conversation · {messages.length} messages →</button>
        </div>
      </section>

      <section className="recommendation-proof">
        <div>
          <p className="app-eyebrow">Why this recommendation</p>
          <h2>Personal context first. Research where it changes the call.</h2>
          <p>Today’s lunch and volume recommendation uses the plan, five comparable afternoon sessions, current recovery, and the user’s familiar meal pattern.</p>
        </div>
        <details>
          <summary>Inspect reasoning + sources</summary>
          <dl>
            <div><dt>Personal record</dt><dd>Five comparable afternoon sessions; familiar pre-training meals were easier to complete and had no logged GI issue.</dd></div>
            <div><dt>Current facts</dt><dd>Short sleep, normal energy, quiet shoulder, no illness or schedule disruption recorded.</dd></div>
            <div><dt>External safety</dt><dd>Examine Connect is reserved for live supplement-interaction checks; it is not needed for today’s meal timing call.</dd></div>
            <div><dt>Next falsifier</dt><dd>Low energy or returning shoulder discomfort at 3:45 changes the recommendation to reduced volume or a session swap.</dd></div>
          </dl>
        </details>
      </section>
    </div>
  );
}

function ConversationSurface({ messages, lunchLogged, sendMessage, goTo }: { messages: AdvisorMessage[]; lunchLogged: boolean; sendMessage: (text: string) => void; goTo: (surface: Surface) => void }) {
  const examine = evidenceConnectors[0];
  const threadRef = useRef<HTMLDivElement>(null);
  const hasNewInput = messages.length > initialConversation.length;

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages.length]);

  return (
    <div className="surface-stack conversation-surface">
      <div className="surface-statusbar">
        <div><span>Last input</span><strong>Today · {hasNewInput ? "12:19 PM" : "12:18 PM"}</strong></div>
        <div><span>Routed today</span><strong>Nutrition · sleep · medication · training</strong></div>
        <div><span>Waiting on</span><strong>{lunchLogged ? "3:45 training check" : "Lunch"}</strong></div>
      </div>

      <section className="conversation-layout">
        <div className="conversation-main">
          <div className="conversation-date"><span>Friday, June 27</span><i /></div>
          <div className="message-thread" aria-live="polite" ref={threadRef}>
            {messages.map((message) => (
              <article key={message.id} className={`conversation-message ${message.role} ${message.kind ?? "record"}`}>
                <div className="message-author"><strong>{message.role === "ashwini" ? "Ashwini" : "You"}</strong><time>{message.time}</time></div>
                <p>{message.text}</p>
                {message.receipt && <span className="message-receipt"><i aria-hidden="true" />{message.receipt}</span>}
              </article>
            ))}
          </div>
          <QuickComposer onSend={sendMessage} expanded />
        </div>

        <aside className="conversation-context">
          <div className="context-card active-context">
            <span>Working model · now</span>
            <h3>{lunchLogged ? "Lunch is covered. Hold the plan until 3:45." : "Keep training. Feed it first. Recheck volume later."}</h3>
            <dl><div><dt>Goal</dt><dd>Rebuild training consistency while cutting slowly</dd></div><div><dt>Next event</dt><dd>Upper body · 4:30 PM</dd></div><div><dt>Active caution</dt><dd>Sleep below usual range</dd></div><div><dt>Missing</dt><dd>{lunchLogged ? "Pre-session energy check" : "Lunch"}</dd></div></dl>
          </div>
          <div className="context-card science-context">
            <span>Science source</span>
            <h3>{examine.name}</h3>
            <strong>{examine.status}</strong>
            <p>{examine.scope}. {examine.boundary}</p>
            <button onClick={() => goTo("evidence")}>Inspect source coverage →</button>
          </div>
          <div className="context-card boundary-context">
            <span>Specialist gate</span>
            <p>Ashwini handles daily recommendations. Diagnosis, prescription changes, and urgent or escalating symptoms become a prepared handoff.</p>
          </div>
        </aside>
      </section>
    </div>
  );
}

function QuickComposer({ onSend, expanded = false }: { onSend: (text: string) => void; expanded?: boolean }) {
  const [draft, setDraft] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim()) return;
    onSend(draft);
    setDraft("");
  };

  return (
    <form className={`quick-composer ${expanded ? "expanded" : ""}`} onSubmit={submit}>
      <div className="composer-tools">
        <span>Tell Ashwini</span>
        <button type="button" onClick={() => setDraft("Lunch photo: House Dal v1 with rice and yogurt.")}>＋ Photo</button>
      </div>
      <textarea aria-label="Tell Ashwini what happened or ask a question" rows={expanded ? 3 : 2} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="What happened, what did you eat, how do you feel, or what should we decide?" />
      <div className="composer-footer">
        <div className="prompt-chips">{quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => setDraft(prompt)}>{prompt}</button>)}</div>
        <Button type="submit" disabled={!draft.trim()}>Send</Button>
      </div>
      <small>Text, photo, document, and corrections enter the same private history.</small>
    </form>
  );
}
