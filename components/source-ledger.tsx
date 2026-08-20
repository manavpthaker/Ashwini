import type { DataSourceStatus } from "@/lib/types";

const sources: DataSourceStatus[] = [
  { name: "WHOOP", detail: "Recovery gate", state: "planned" },
  { name: "Apple Health", detail: "Daily shortcut", state: "planned" },
  { name: "iMessage", detail: "Training + nutrition", state: "planned" },
  { name: "Medication", detail: "Adherence history", state: "planned" },
];

export function SourceLedger() {
  return (
    <section className="ledger" aria-labelledby="ledger-heading">
      <div className="section-heading">
        <p className="eyebrow">Phase 0 · pipes</p>
        <h2 id="ledger-heading">Nothing is trusted until it lands.</h2>
      </div>
      <ul>
        {sources.map((source) => (
          <li key={source.name}>
            <span className={`status status-${source.state}`} aria-label={source.state} />
            <div><strong>{source.name}</strong><small>{source.detail}</small></div>
            <em>Not connected</em>
          </li>
        ))}
      </ul>
    </section>
  );
}
