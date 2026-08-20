"use client";

import { useState } from "react";
import type { TodayDecision } from "@/lib/types";

export function TodayInstrument({ decision }: { decision: TodayDecision }) {
  const [answer, setAnswer] = useState<string | null>(null);

  return (
    <section className="instrument" aria-labelledby="decision-heading">
      <div className="instrument-topline">
        <span className="voice-mark">{decision.voice}</span>
        <span className="live-dot">Open decision</span>
      </div>
      <p className="eyebrow">Right now</p>
      <h1 id="decision-heading">{answer ? "Decision logged." : decision.question}</h1>
      <p className="instrument-context">
        {answer
          ? `You chose “${answer}.” The system will record the action; it will not turn this into another notification.`
          : decision.context}
      </p>
      <div className="answer-row" aria-label="Decision choices">
        {decision.choices.map((choice) => (
          <button key={choice} className={answer === choice ? "selected" : ""} onClick={() => setAnswer(choice)}>
            {choice}
          </button>
        ))}
      </div>
    </section>
  );
}
