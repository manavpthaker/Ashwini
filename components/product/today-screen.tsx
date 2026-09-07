"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { partOfDay } from "@/domain/clock";
import { EVIDENCE_LABEL } from "@/domain/evidence";
import { DOMAIN_LABEL } from "@/domain/domains";
import { buttonClassName, Button, Eyebrow, Status, type StatusTone } from "@/components/design-system/ui";
import {
  ArrowIcon,
  BowlIcon,
  CareIcon,
  ClockIcon,
  MedicationIcon,
  MoonIcon,
  MovementIcon,
  RuleIcon,
} from "@/components/product/icons";
import { useProduct } from "@/components/product/product-provider";
import type { CheckinRecord, PerspectiveContribution, PerspectiveTone } from "@/lib/product-model";
import {
  fetchTodaySnapshot,
  RecordApiError,
  type OpenDecision,
  type TodaySnapshot,
} from "@/lib/record-client";
import styles from "./today-screen.module.css";
import { fetchHealthBrief, type HealthBrief } from "@/lib/health-brief";
import { sourceDateLabel } from "@/lib/health-context-display";

const toneIcon = {
  nutrition: BowlIcon,
  recovery: MoonIcon,
  training: MovementIcon,
  medication: MedicationIcon,
  care: CareIcon,
} satisfies Record<PerspectiveTone, typeof BowlIcon>;

const perspectiveByDomain = {
  training: { role: "Training", tone: "training" },
  nutrition: { role: "Nutrition", tone: "nutrition" },
  medication: { role: "Medication", tone: "medication" },
  body: { role: "Recovery", tone: "recovery" },
  focus: { role: "Recovery", tone: "recovery" },
  system: { role: "Care navigation", tone: "care" },
} as const;

const routeHeadline = {
  emergency: "Seek emergency help now.",
  crisis_line: "Talk to an appropriate crisis service now.",
  clinician: "A clinician needs to review this.",
  pharmacist: "A pharmacist should answer this.",
  prescriber: "Your prescriber should answer this.",
  dermatologist: "This is documented for a dermatologist, not assessed here.",
} as const;

function subscribeToMinute(onChange: () => void) {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
}

function useNow(): Date | null {
  const minute = useSyncExternalStore(
    subscribeToMinute,
    () => Math.floor(Date.now() / 60_000),
    () => null,
  );
  return minute === null ? null : new Date(minute * 60_000);
}

function formattedNow(at: Date | null, timeZone?: string): string {
  if (!at) return "…";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

function briefLabel(part: TodaySnapshot["partOfDay"] | undefined): string {
  if (!part) return "Your brief";
  if (part === "early-morning" || part === "morning") return "Your morning brief";
  if (part === "midday") return "Your midday brief";
  if (part === "afternoon") return "Your afternoon brief";
  return "Your evening brief";
}

function perspectiveFor(decision: OpenDecision): PerspectiveContribution {
  const perspective = perspectiveByDomain[decision.domain];
  return {
    role: perspective.role,
    tone: perspective.tone,
    state: EVIDENCE_LABEL[decision.evidenceStatus],
    summary: decision.confidenceNote,
    basis: decision.gateReason,
    origin: "ashwini_synthesis",
  };
}

function headlineFor(decision: OpenDecision): string {
  if (decision.route) return routeHeadline[decision.route];
  return decision.target ?? (decision.reply.receipt || "A decision is open.");
}

function toneFor(decision: OpenDecision): StatusTone {
  if (decision.route || decision.gateOutcome === "blocked") return "route";
  if (decision.domain === "nutrition") return "nutrition";
  if (decision.domain === "training") return "training";
  return "recovery";
}

function nextLabelFor(decision: OpenDecision | undefined): string {
  if (!decision) return "Check-in";
  if (decision.route) return "Contact a professional";
  if (decision.choices.length > 0) return "Plan choice";
  if (decision.type === "data_quality_block") return "Review missing evidence";
  return "Review prompt";
}

function checkinTone(record: CheckinRecord): StatusTone {
  if (record.response.kind === "route-out") return "route";
  if (record.response.perspectives.some((item) => item.tone === "nutrition")) {
    return "nutrition";
  }
  if (
    record.response.perspectives.some(
      (item) => item.tone === "training" || item.tone === "recovery",
    )
  ) {
    return "training";
  }
  return "neutral";
}

function PerspectivePath({ item, nextLabel }: { item: PerspectiveContribution; nextLabel: string }) {
  return (
    <div className={styles.consultationPath} aria-label={`${item.role} perspective supports the current decision`}>
      <div className={styles.pathCopy}>
        <span>Relevant perspective</span>
        <strong>One current decision</strong>
      </div>
      <svg className={styles.pathGraphic} viewBox="0 0 720 132" role="img" aria-labelledby="path-title path-description">
        <title id="path-title">How the current decision is framed</title>
        <desc id="path-description">The persisted {item.role} reasoning perspective leads to the current decision and then to {nextLabel}.</desc>
        <path className={styles[`${item.tone}Path`]} d="M18 66 C180 66 212 66 360 66 S510 66 700 66" />
        <circle className={styles[`${item.tone}Dot`]} cx="18" cy="66" r="7" />
        <circle className={styles.convergenceDot} cx="360" cy="66" r="13" />
        <circle className={styles.nextDot} cx="700" cy="66" r="8" />
      </svg>
      <div className={styles.pathLabels} aria-hidden="true">
        <div className={styles.pathDomains}><span><i className={styles[`${item.tone}Swatch`]} />{item.role}</span></div>
        <span className={styles.pathOutcome}>Now</span>
        <span>{nextLabel}</span>
      </div>
    </div>
  );
}

function EmptyPath() {
  return (
    <div className={styles.consultationPath}>
      <div className={styles.pathCopy}>
        <span>Record state</span>
        <strong>No open decision</strong>
      </div>
      <p className={styles.emptyPathCopy}>Saved events remain visible without turning missing information into a decision.</p>
    </div>
  );
}

function Perspectives({ items }: { items: readonly PerspectiveContribution[] }) {
  return (
    <aside className={styles.perspectives} aria-labelledby="perspectives-title">
      <div className={styles.perspectiveHeading}>
        <div>
          <Eyebrow>Coordinated guidance</Eyebrow>
          <h2 id="perspectives-title">Perspective behind the decision</h2>
        </div>
        <span>{items.length} relevant now</span>
      </div>

      {items.length > 0 ? (
        <div className={styles.perspectiveList}>
          {items.map((item) => {
            const Icon = toneIcon[item.tone];
            return (
              <article className={`${styles.perspectiveCard} ${styles[item.tone]}`} key={`${item.role}-${item.state}`}>
                <div className={styles.perspectiveIcon} aria-hidden="true"><Icon /></div>
                <div>
                  <div className={styles.perspectiveMeta}><h3>{item.role}</h3><span>{item.state}</span></div>
                  <p>{item.summary}</p>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className={styles.emptyPerspective}>No reasoning perspective is active because there is no open decision.</p>
      )}

      <p className={styles.perspectiveBoundary}>A perspective is an Ashwini reasoning lens—not a message from a provider or proof of human review.</p>
    </aside>
  );
}

export interface TimelineItem {
  id: string;
  at: string;
  domain: string;
  title: string;
  detail: string;
  state?: "complete" | "current" | "upcoming";
}

export function dayInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function buildTimeline(
  snapshot: TodaySnapshot,
  checkins: readonly CheckinRecord[],
  primaryDecision: OpenDecision | undefined,
  now: Date,
): readonly TimelineItem[] {
  const structuredMessageIds = new Set(snapshot.meals.flatMap((meal) => meal.messageId ? [meal.messageId] : []));
  const supersededMessageIds = new Set(
    checkins.flatMap((checkin) => (checkin.correctionOf ? [checkin.correctionOf] : [])),
  );
  const items: TimelineItem[] = [];

  for (const checkin of checkins) {
    // Corrections remain visible in Check-in history for provenance, but the
    // superseded advice must not continue to present as part of today's state.
    if (supersededMessageIds.has(checkin.id)) continue;
    if (!checkin.recordedAt || dayInZone(checkin.recordedAt, snapshot.timeZone) !== snapshot.day) continue;
    if (structuredMessageIds.has(checkin.id)) continue;
    items.push({
      id: `checkin-${checkin.id}`,
      at: checkin.recordedAt,
      domain: checkin.response.perspectives[0]?.role ?? "Check-in",
      title: checkin.response.headline,
      detail: checkin.response.decision?.selectedChoice
        ? `${checkin.response.receipt} · response: ${checkin.response.decision.selectedChoice}`
        : checkin.response.receipt,
      ...(primaryDecision?.sourceMessageId === checkin.id
        ? { state: "current" as const }
        : checkin.response.decision?.selectedChoice === "Acknowledged"
          ? { state: "complete" as const }
          : checkin.response.kind === "follow-up" ||
              checkin.response.decision?.selectedChoice
            ? { state: "current" as const }
          : {}),
    });
  }

  for (const meal of snapshot.meals) {
    const range = meal.proteinRange
      ? ` · ${meal.proteinRange.low}–${meal.proteinRange.high} g protein`
      : " · nutrition amount unknown";
    items.push({
      id: `meal-${meal.id}`,
      at: meal.at,
      domain: "Nutrition",
      title: `${meal.kind ? `${meal.kind.charAt(0).toUpperCase()}${meal.kind.slice(1)}` : "Meal"} recorded`,
      detail: `${meal.description ?? `${meal.source} record`} · ${meal.confidence} confidence${range}`,
      state: "complete",
    });
  }

  for (const dose of snapshot.doses) {
    const recordedAt = dose.takenAt ?? dose.scheduledAt;
    if (!recordedAt) continue;
    items.push({
      id: `dose-${dose.id}`,
      at: recordedAt,
      domain: "Medication",
      title: dose.skipped ? `${dose.medication.name} skipped` : dose.takenAt ? `${dose.medication.name} taken` : `${dose.medication.name} scheduled`,
      detail: dose.skipReason ?? dose.note ?? "Protected medication record",
      ...(dose.skipped || dose.takenAt
        ? { state: "complete" as const }
        : dose.scheduledAt && new Date(dose.scheduledAt) > now
          ? { state: "upcoming" as const }
          : {}),
    });
  }

  for (const commitment of snapshot.commitments) {
    const startsAt = new Date(commitment.startsAt);
    const active = startsAt <= now && (!commitment.endsAt || new Date(commitment.endsAt) >= now);
    items.push({
      id: `commitment-${commitment.id}`,
      at: commitment.startsAt,
      domain: DOMAIN_LABEL[commitment.domain],
      title: commitment.title,
      detail: commitment.detail ?? `${commitment.kind} commitment`,
      ...(startsAt > now ? { state: "upcoming" as const } : active ? { state: "current" as const } : {}),
    });
  }

  for (const session of snapshot.trainingSessions) {
    items.push({
      id: `session-${session.id}`,
      at: session.at,
      domain: "Training and recovery",
      title: session.kind ?? "Training session",
      detail: session.completed ? "Completed and recorded" : session.volumeNote ?? (session.planned ? "Planned" : "Recorded"),
      ...(session.completed ? { state: "complete" as const } : new Date(session.at) > now ? { state: "upcoming" as const } : {}),
    });
  }

  return items.sort((left, right) => left.at.localeCompare(right.at));
}

function timeLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function currentPartOfDay(
  at: Date,
  timeZone: string,
): TodaySnapshot["partOfDay"] {
  return partOfDay({ now: () => at, timeZone: () => timeZone }, at);
}

export function needsTodayRefresh(
  snapshot: Pick<TodaySnapshot, "day" | "timeZone">,
  at: Date,
): boolean {
  return dayInZone(at.toISOString(), snapshot.timeZone) !== snapshot.day;
}

export function nextUpcomingTimelineItem(
  timeline: readonly TimelineItem[],
  at: Date,
): TimelineItem | undefined {
  return timeline.find(
    (item) => item.state === "upcoming" && new Date(item.at).getTime() > at.getTime(),
  );
}

function continuityTimestamp(record: CheckinRecord): number {
  const value = record.response.decision?.respondedAt ?? record.recordedAt;
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function latestContinuityCheckin(
  checkins: readonly CheckinRecord[],
): CheckinRecord | undefined {
  return checkins
    .filter(
      (record) =>
        record.response.kind === "follow-up" ||
        Boolean(record.response.decision?.selectedChoice),
    )
    .slice()
    .sort((left, right) => continuityTimestamp(right) - continuityTimestamp(left))[0];
}

export function healthBriefIsPrimary(state: {
  decisionsLoading: boolean;
  decisionsError: string | null;
  hasDecision: boolean;
  hasPending: boolean;
  hasAnswered: boolean;
  available: boolean;
}): boolean {
  return state.available && !state.decisionsLoading && !state.decisionsError && !state.hasDecision && !state.hasPending && !state.hasAnswered;
}

function HealthBriefEvidence({ brief }: { brief: HealthBrief }) {
  return (
    <aside className={`${styles.perspectives} ${styles.contextEvidence}`} aria-labelledby="context-evidence-title">
      <h2 id="context-evidence-title">The context behind this</h2>
      {brief.context.map((entry, index) => (
        <details className={styles.contextExcerpt} key={entry.id} open={index === 0}>
          <summary>{entry.sourceLabel}<small>{sourceDateLabel(entry)} · {entry.temporalStatus === "current" ? "Marked current by source" : "Historical context"}</small></summary>
          <p>{entry.statement}</p>
        </details>
      ))}
      {brief.coverage.length > 0 && <div className={styles.coverage}>
        <h3>How recent is the wearable record?</h3>
        <dl>{brief.coverage.map((item) => <div key={item.type}>
          <dt>{item.label}</dt>
          <dd>{item.latestEndAt ? new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: brief.timeZone }).format(new Date(item.latestEndAt)) : "No samples found"}<span>{item.freshness === "recent" ? "Within 7 days" : item.freshness === "historical" ? "Historical, not current" : "Unknown"}{item.windowTruncated ? " · partial window" : ""}</span></dd>
        </div>)}</dl>
      </div>}
      <p className={styles.perspectiveBoundary}>{brief.limitation}</p>
      <Link className={buttonClassName("quiet")} href="/context">See health context</Link>
    </aside>
  );
}

export function TodayScreen() {
  const router = useRouter();
  const { checkins, openDecisions, decisionsLoading, decisionsError, historyError, reloadRecords } = useProduct();
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [healthBrief, setHealthBrief] = useState<HealthBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(true);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const now = useNow();
  const reasoningRef = useRef<HTMLDetailsElement>(null);
  // A history/timeline read must never hide an already loaded safety decision.
  const primaryDecision = openDecisions[0];
  const loading = !primaryDecision && decisionsLoading;
  const error = primaryDecision ? null : decisionsError;
  const supersededIds = useMemo(
    () =>
      new Set(
        checkins.flatMap((record) => (record.correctionOf ? [record.correctionOf] : [])),
      ),
    [checkins],
  );
  const currentDayCheckins = useMemo(
    () =>
      snapshot
        ? checkins.filter(
            (record) =>
              !supersededIds.has(record.id) &&
              record.recordedAt &&
              dayInZone(record.recordedAt, snapshot.timeZone) === snapshot.day,
          )
        : [],
    [checkins, snapshot, supersededIds],
  );
  const continuityCheckin = primaryDecision
    ? undefined
    : latestContinuityCheckin(currentDayCheckins);
  const pendingCheckin =
    continuityCheckin?.response.kind === "follow-up" &&
    !continuityCheckin.response.decision?.selectedChoice
      ? continuityCheckin
      : undefined;
  const answeredCheckin = continuityCheckin?.response.decision?.selectedChoice
    ? continuityCheckin
    : undefined;
  const perspectives = primaryDecision
    ? [perspectiveFor(primaryDecision)]
    : (continuityCheckin?.response.perspectives ?? []);
  const showingHealthBrief = healthBriefIsPrimary({ decisionsLoading, decisionsError, hasDecision: Boolean(primaryDecision), hasPending: Boolean(pendingCheckin), hasAnswered: Boolean(answeredCheckin), available: Boolean(healthBrief?.available) });

  useEffect(() => {
    const controller = new AbortController();
    fetchHealthBrief(controller.signal)
      .then((brief) => { if (!controller.signal.aborted) { setHealthBrief(brief); setBriefError(null); } })
      .catch(() => { if (!controller.signal.aborted) setBriefError("Your health brief could not be refreshed. Your saved history has not been changed."); })
      .finally(() => { if (!controller.signal.aborted) setBriefLoading(false); });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTodaySnapshot(controller.signal)
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
        setSnapshotError(cause instanceof Error ? cause.message : "Today’s record is unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setSnapshotLoading(false);
      });
    return () => controller.abort();
  }, [router, refreshKey]);

  useEffect(() => {
    if (!snapshot || !now || !needsTodayRefresh(snapshot, now)) return;

    const controller = new AbortController();
    fetchTodaySnapshot(controller.signal)
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
        setSnapshotError(cause instanceof Error ? cause.message : "Today’s record is unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setSnapshotLoading(false);
      });

    return () => controller.abort();
  }, [now, router, snapshot]);

  const timeline = useMemo(
    () => snapshot && now ? buildTimeline(snapshot, checkins, primaryDecision, now) : [],
    [snapshot, now, checkins, primaryDecision],
  );
  const upcomingTimelineItem = now ? nextUpcomingTimelineItem(timeline, now) : undefined;
  const hasTodayRecord = timeline.length > 0;

  const view = loading
    ? {
        eyebrow: "Private record",
        headline: "Opening your private record…",
        summary: "Ashwini will not infer a plan until the saved record is available.",
        status: "Loading",
        tone: "neutral" as StatusTone,
        recheck: "Record read in progress",
        known: "No personal state rendered before the read completes.",
        changes: "A successful record read.",
      }
    : error
      ? {
          eyebrow: "Record unavailable",
          headline: "Ashwini cannot tell what is current.",
          summary: `${error} No meal, medication, training, or decision state is being inferred from that failure.`,
          status: "Unavailable",
          tone: "route" as StatusTone,
          recheck: "Try again shortly",
          known: "The record read did not complete.",
          changes: "A successful refresh or restored database connection.",
        }
      : primaryDecision
        ? {
            eyebrow: "Current decision",
            headline: headlineFor(primaryDecision),
            summary: primaryDecision.reply.text,
            status: EVIDENCE_LABEL[primaryDecision.evidenceStatus],
            tone: toneFor(primaryDecision),
            recheck: primaryDecision.route
              ? "Contact the named professional"
              : primaryDecision.choices.length
                ? `${primaryDecision.choices.length} choices in Plan`
                : primaryDecision.type === "data_quality_block"
                  ? "Missing evidence"
                  : "Review the saved prompt",
            known: primaryDecision.confidenceNote,
            changes: primaryDecision.gateReason,
          }
        : pendingCheckin
          ? {
              eyebrow: "Complete this check-in",
              headline: pendingCheckin.response.headline,
              summary: pendingCheckin.response.recommendation,
              status: pendingCheckin.response.status,
              tone: checkinTone(pendingCheckin),
              recheck: "One useful detail",
              known: pendingCheckin.response.interpretation,
              changes: "Adding the requested detail as a correction to this check-in.",
            }
          : answeredCheckin?.response.decision?.selectedChoice
            ? {
                eyebrow: "Your recorded response",
                headline: answeredCheckin.response.decision.selectedChoice,
                summary:
                  answeredCheckin.response.decision.selectedChoice === "Acknowledged"
                    ? "The prompt is closed in Ashwini. The underlying concern is not marked resolved."
                    : "This is the response you recorded against the latest decision; it remains attached to the check-in.",
                status: "Recorded",
                tone: checkinTone(answeredCheckin),
                recheck: "Change it with a new check-in",
                known: answeredCheckin.response.interpretation,
                changes: "A correction, a new check-in, or a later recorded decision.",
              }
        : showingHealthBrief && healthBrief
          ? {
              eyebrow: "Your health context",
              headline: healthBrief.headline,
              summary: healthBrief.summary,
              status: "Source-backed brief",
              tone: "recovery" as StatusTone,
              recheck: "Connect this with today",
              known: healthBrief.limitation,
              changes: "New source data, a correction, or a check-in about how you feel today.",
            }
        : briefLoading
          ? { eyebrow: "Health context", headline: "Reading the context behind your day…", summary: "Your saved history is being prepared as a short, dated brief.", status: "Loading context", tone: "neutral" as StatusTone, recheck: "No new check-in created", known: "Context read in progress.", changes: "A completed context read." }
        : hasTodayRecord
          ? {
              eyebrow: "Current record",
              headline: "Nothing is asking for a decision right now.",
              summary: "Your saved records remain available below. Ashwini will not manufacture a recommendation simply to fill the brief.",
              status: "Recorded",
              tone: "neutral" as StatusTone,
              recheck: "Check in when something changes",
              known: "No unresolved decision was returned by the record.",
              changes: "A new check-in, commitment, or saved decision.",
            }
          : {
              eyebrow: "Start here",
              headline: "What would be useful to decide today?",
              summary: "Tell Ashwini what happened, what feels off, or the choice in front of you. You will get one bounded action, one useful question, or a clear professional boundary.",
              status: "No events today",
              tone: "neutral" as StatusTone,
              recheck: "Start your first check-in",
              known: "No event or check-in was returned for the configured day.",
              changes: "A recorded check-in, dose, meal, commitment, or session.",
            };

  const nextStep = error
    ? "Record unavailable"
    : primaryDecision
      ? nextLabelFor(primaryDecision)
      : pendingCheckin
        ? "Complete the check-in"
        : answeredCheckin?.response.decision?.selectedChoice
          ? answeredCheckin.response.decision.selectedChoice
      : showingHealthBrief
        ? "Review your health context"
      : upcomingTimelineItem
        ? `${upcomingTimelineItem.title} · ${snapshot ? timeLabel(upcomingTimelineItem.at, snapshot.timeZone) : ""}`
        : checkins.length === 0
          ? "Start a check-in"
          : "No open action";

  const showReasoning = () => {
    if (!reasoningRef.current) return;
    reasoningRef.current.open = true;
    reasoningRef.current.scrollIntoView({ block: "nearest" });
    reasoningRef.current.querySelector("summary")?.focus({ preventScroll: true });
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="page-title">
        <div className={styles.heroMeta}>
          <div><span>{briefLabel(snapshot && now ? currentPartOfDay(now, snapshot.timeZone) : undefined)}</span><strong>{formattedNow(now, snapshot?.timeZone)}</strong></div>
          <div><span>Next recorded step</span><strong>{nextStep}</strong></div>
        </div>

        <div className={styles.heroGrid}>
          <div className={styles.primaryRead}>
            <Eyebrow>{view.eyebrow}</Eyebrow>
            <h1 id="page-title" tabIndex={-1}>{view.headline}</h1>
            <p className={styles.summary}>{view.summary}</p>
            {showingHealthBrief && healthBrief && <p className={styles.briefNextStep}><strong>A useful next step</strong>{healthBrief.nextStep}</p>}

            <div className={styles.statusRow}>
              <Status tone={view.tone}><RuleIcon />{view.status}</Status>
              <Status tone={view.tone === "route" ? "route" : "training"}><ClockIcon />{view.recheck}</Status>
            </div>

            <div className={styles.actions}>
              <Link
                href={pendingCheckin
                  ? { pathname: "/check-in", query: { complete: pendingCheckin.id } }
                  : showingHealthBrief ? { pathname: "/check-in", query: { review: "context" } }
                  : "/check-in"}
                className={buttonClassName("primary")}
              >
                {pendingCheckin ? "Add the missing detail" : showingHealthBrief ? "Review my health context" : "Check in"} <ArrowIcon />
              </Link>
              {!loading && !error && <Button variant="secondary" onClick={showReasoning}>Why this?</Button>}
              {primaryDecision ? (
                <Link href="/plan" className={buttonClassName("quiet")}>
                  {primaryDecision.choices.length ? "See choices" : "Review decision"} <ArrowIcon />
                </Link>
              ) : null}
              {error || briefError || snapshotError || historyError ? <Button variant="secondary" onClick={() => { setBriefLoading(true); setSnapshotLoading(true); setRefreshKey((key) => key + 1); void reloadRecords(); }}>Retry unavailable reads</Button> : null}
            </div>

            {!loading && !error && (
              <details className={styles.reasoning} id="reasoning" ref={reasoningRef}>
                <summary>Why this is shown</summary>
                <dl>
                  <div><dt>Known now</dt><dd>{view.known}</dd></div>
                  <div><dt>Evidence state</dt><dd>{view.status}{primaryDecision ? ` · ${primaryDecision.reply.receipt} · ${primaryDecision.advisorVersion}` : continuityCheckin ? ` · ${continuityCheckin.response.receipt}` : " · no open decision"}</dd></div>
                  <div><dt>What changes it</dt><dd>{view.changes}</dd></div>
                  {primaryDecision?.refused && <div><dt>Not claimed</dt><dd>{primaryDecision.refused}</dd></div>}
                </dl>
              </details>
            )}
          </div>

          {!loading && !error && !showingHealthBrief ? (
            perspectives[0]
              ? <PerspectivePath item={perspectives[0]} nextLabel={primaryDecision ? nextLabelFor(primaryDecision) : pendingCheckin ? "Add one detail" : "Recorded response"} />
              : <EmptyPath />
          ) : null}
          {showingHealthBrief && healthBrief ? <HealthBriefEvidence brief={healthBrief} /> : !loading && !error ? <Perspectives items={perspectives} /> : null}
        </div>
      </section>

      {briefError || historyError || decisionsError ? <p className={styles.readNotice} role="status">{[briefError, historyError, decisionsError].filter(Boolean).join(" ")} Previously loaded information may be out of date.</p> : null}

      <section className={styles.timelineSection} aria-labelledby="today-timeline-title">
        <div className={styles.sectionHeading}>
          <div><Eyebrow>Saved continuity</Eyebrow><h2 id="today-timeline-title">Today</h2></div>
          <p>Only stored check-ins, meals, doses, commitments, and sessions appear here.</p>
        </div>

        {snapshotError ? (
          <p className={styles.timelineEmpty} role="alert">{snapshotError} No timeline was inferred.</p>
        ) : snapshotLoading ? (
          <p className={styles.timelineEmpty} role="status">Loading today’s saved records…</p>
        ) : timeline.length === 0 ? (
          <p className={styles.timelineEmpty}>No events or check-ins are recorded today.</p>
        ) : (
          <div className={styles.timeline}>
            {timeline.map((event) => (
              <article className={event.state ? styles[event.state] : undefined} key={event.id}>
                <time>{snapshot ? timeLabel(event.at, snapshot.timeZone) : ""}</time>
                <span>{event.domain}</span>
                <strong>{event.title}</strong>
                <small>{event.detail}</small>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
