"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { HealthHistoryEntry } from "@/domain/advisor/types";
import { HEALTH_CONTEXT_CATEGORIES, healthContextImportSchema, type HealthContextCategory, type HealthContextImport } from "@/lib/health-context";
import { Button, Eyebrow, Status } from "@/components/design-system/ui";
import { ShieldIcon } from "@/components/product/icons";
import styles from "./context-screen.module.css";

interface ContextSnapshot {
  history: HealthHistoryEntry[];
  mode: { configured: boolean; provider: "openai" | "rules"; model: string | null; contextConsent: boolean };
  generatedAt: string;
}

const categoryLabels: Record<HealthContextCategory, string> = {
  condition: "Reported conditions",
  medication_history: "Medication history",
  supplement_history: "Supplement history",
  goal: "Goals & priorities",
  nutrition: "Food & nutrition",
  training: "Movement & training",
  sleep: "Sleep & recovery",
  preference: "What works for you",
  measurement: "Measurements",
  care_context: "Care & personal context",
};

export function sourceDateLabel(entry: Pick<HealthHistoryEntry, "sourceDate" | "sourceDatePrecision">): string {
  if (!entry.sourceDate || entry.sourceDatePrecision === "unknown") return "Source date unknown";
  if (entry.sourceDatePrecision === "year") return entry.sourceDate.slice(0, 4);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    ...(entry.sourceDatePrecision === "month" ? {} : { day: "numeric" as const }),
    timeZone: "UTC",
  }).format(new Date(`${entry.sourceDate}T00:00:00Z`));
}

export function ContextScreen() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<ContextSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<HealthContextImport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileVersion = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/context", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) throw new Error("Your health context could not be opened. Try again.");
        const value = await response.json() as ContextSnapshot;
        if (!controller.signal.aborted) {
          setSnapshot(value);
          setError(null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Your health context could not be opened. Try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [router, refresh]);

  async function chooseFile(file: File | undefined) {
    const version = ++fileVersion.current;
    setPreview(null);
    setFileName(null);
    setReceipt(null);
    setImportError(null);
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setImportError("Choose a JSON file no larger than 1 MB.");
      return;
    }
    try {
      const parsed = healthContextImportSchema.safeParse(JSON.parse(await file.text()));
      if (fileVersion.current !== version) return;
      if (!parsed.success) {
        setImportError("This is not a curated health-context file. Raw documents and Apple Health exports need preparation first.");
        return;
      }
      setPreview(parsed.data);
      setFileName(file.name);
    } catch {
      if (fileVersion.current === version) setImportError("This file could not be read as JSON.");
    }
  }

  async function importContext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || importing) return;
    setImporting(true);
    setImportError(null);
    setReceipt(null);
    try {
      const response = await fetch("/api/context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(preview),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        setImportError(response.status === 409
          ? "This source version already exists with different details. Its curation revision needs updating."
          : "The import could not be confirmed. Your file is still selected; retrying it is safe.");
        return;
      }
      const result = await response.json() as { entriesInserted: number; sourcesInserted: number; sourcesUnchanged: number };
      setReceipt(result.sourcesInserted === 0
        ? "This context is already saved. No duplicate records were added."
        : `${result.entriesInserted} details saved from ${result.sourcesInserted} source${result.sourcesInserted === 1 ? "" : "s"}. ${result.sourcesUnchanged ? `${result.sourcesUnchanged} unchanged source${result.sourcesUnchanged === 1 ? "" : "s"} skipped.` : "Previous versions stay in your record."}`);
      setPreview(null);
      setFileName(null);
      if (fileInput.current) fileInput.current.value = "";
      setLoading(true);
      setRefresh((value) => value + 1);
    } catch {
      setImportError("The import could not be confirmed. Your file is still selected; retrying it is safe.");
    } finally {
      setImporting(false);
    }
  }

  const history = snapshot?.history ?? [];
  const pending = history.filter((entry) => entry.confirmationRequired).length;
  const previewEntries = preview?.sources.reduce((sum, source) => sum + source.entries.length, 0) ?? 0;

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <Eyebrow>Your private record</Eyebrow>
        <h1 id="page-title" tabIndex={-1}>The history behind<br />your check-in.</h1>
        <p>Health context to build on, with the source and uncertainty kept in view.</p>
      </header>

      <div className={styles.layout}>
        <section className={styles.record} aria-labelledby="saved-context-title">
          <div className={styles.sectionHeading}>
            <h2 id="saved-context-title">What Ashwini knows</h2>
            <span>{loading ? "Opening context…" : error ? "Unavailable" : `${history.length} saved details`}</span>
          </div>
          {error ? (
            <div className={styles.empty} role="alert">
              <p>{error}</p>
              <Button variant="secondary" onClick={() => { setLoading(true); setRefresh((value) => value + 1); }}>Try again</Button>
            </div>
          ) : loading ? (
            <p className={styles.empty} role="status">Loading your saved history…</p>
          ) : history.length === 0 ? (
            <div className={styles.empty}>
              <h3>Your history has a place here.</h3>
              <p>No health-context details have been imported yet. Choose a prepared file to bring in goals, preferences and relevant history.</p>
            </div>
          ) : (
            <>
              <p className={styles.recordNote}>{pending > 0 ? `${pending} details still need confirmation. ` : ""}Saved history is not a diagnosis, a dose log or proof that an old plan is current.</p>
              {HEALTH_CONTEXT_CATEGORIES.map((category) => {
                const entries = history.filter((entry) => entry.category === category);
                if (!entries.length) return null;
                return (
                  <details className={styles.group} key={category} open={category === "condition"}>
                    <summary><span>{categoryLabels[category]}</span><span className={styles.groupCount}>{entries.length}</span></summary>
                    <ul className={styles.entries}>
                      {entries.map((entry) => (
                        <li key={entry.id}>
                          <div className={styles.metadata}>
                            <Status tone={entry.confirmationRequired ? "warning" : "neutral"}>
                              {entry.temporalStatus === "historical" ? "Historical" : entry.temporalStatus === "current" ? "Marked current by source" : "Timing unconfirmed"}
                            </Status>
                            {entry.confirmationRequired ? <span>Needs confirmation</span> : null}
                          </div>
                          <p className={styles.statement}>{entry.statement}</p>
                          <p className={styles.source}>{entry.sourceLabel} · {sourceDateLabel(entry)}</p>
                          <details className={styles.provenance}><summary>Source detail</summary><p>{entry.sourceLocator}</p></details>
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </>
          )}
        </section>

        <aside className={styles.aside} aria-label="Context management">
          <section className={styles.importPanel} aria-labelledby="import-title">
            <Eyebrow>Bring your history</Eyebrow>
            <h2 id="import-title">Start with what’s already known.</h2>
            <p>Choose a curated context file. You’ll review its sources before anything is saved.</p>
            <form onSubmit={(event) => void importContext(event)}>
              <label className={styles.fileLabel} htmlFor="context-file">Health-context JSON · up to 1 MB</label>
              <input ref={fileInput} id="context-file" type="file" accept=".json,application/json" disabled={importing} onChange={(event) => void chooseFile(event.target.files?.[0])} />
              {preview ? (
                <div className={styles.preview}>
                  <strong>{previewEntries} details · {preview.sources.length} sources</strong>
                  <p className={styles.fileName}>{fileName}</p>
                  <ul>{preview.sources.map((source) => <li key={source.key}>{source.label} <span>({source.entries.length})</span></li>)}</ul>
                  <p>Historical records keep their dates. Reimports won’t duplicate the same source version.</p>
                </div>
              ) : null}
              <Button type="submit" disabled={!preview || importing}>{importing ? "Saving context…" : "Import health context"}</Button>
              {importError ? <p className={styles.error} role="alert">{importError}</p> : null}
              {receipt ? <p className={styles.receipt} role="status">{receipt}</p> : null}
            </form>
            <p className={styles.finePrint}>Curated facts only, without therapy narratives. Raw PDFs, photos and Apple Health exports are not accepted by this form.</p>
          </section>

          <section className={styles.boundary} aria-labelledby="context-boundary-title">
            <ShieldIcon />
            <h2 id="context-boundary-title">Keep the nuance.</h2>
            <p>Different sources can describe different plans. Imported medication history does not change prescriptions or confirm current use.</p>
            <p>Dates and gaps stay visible so an inference can be useful without becoming a false fact.</p>
          </section>

          <section className={styles.mode} aria-labelledby="advisor-mode-title">
            <h2 id="advisor-mode-title">Advisor mode</h2>
            <p>{snapshot ? snapshot.mode.configured ? "OpenAI model configured" : "Rule-based guidance" : "Status not yet available"}</p>
            <small>{snapshot?.mode.configured
              ? "Configuration is present. This status does not verify a live model response; safety checks and rule-based fallback still apply."
              : "Model-backed synthesis requires a server key, a selected model and explicit consent to send health context. No model access is implied by importing a file."}</small>
          </section>
        </aside>
      </div>
    </div>
  );
}
