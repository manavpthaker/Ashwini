# Ashwini

**A private personal health instrument that turns lived variation into a small number of trustworthy decisions.**

Ashwini is not a dashboard, a diagnosis tool, or a chatbot with health data attached. It records what happened, makes the quality of evidence legible, helps run low-risk daily learning routines, and speaks only when the next action changes.

The working product/domain name is **ashwini.health**. Ashwini invokes the Ashvins: the Vedic physicians associated with dawn and healing. The product does not diagnose, prescribe, or replace clinical care.

## Product definition

The current product direction is locked in [`docs/PRD.md`](docs/PRD.md).

Its central idea is a progression from observed association to deliberate personal learning:

1. Notice natural variation without inventing a conclusion.
2. Track a small, intentional, low-risk routine.
3. Make uncertainty visible while evidence accumulates.
4. Recognize a consistent pattern only in comparable, clean conditions.
5. Propose a bounded comparison when it is worthwhile and safe.
6. Keep a personally useful routine only when repeated evidence supports it.

The goal is a durable habit of careful self-experimentation—not a machine that turns two days of data into medical-sounding certainty.

## Repository status

This is a product-design repository with a **full-scope synthetic product prototype**. The PRD remains the authority; the interface demonstrates its major surfaces and boundaries without implying that ingestion, storage, model inference, or private infrastructure is already operational.

The prototype includes:

- **Today:** an evidence router, a deliberately small decision queue, active learning routines, suppressed observations, and professional route-outs.
- **Capture:** synthetic meal-photo estimation, standardized body capture, low-burden mood/focus prompts, protected medication adherence, and document recording.
- **Review:** training, nutrition, body/aesthetic, mood/focus, and medication records with explicit evidence labels, confound gates, comparable windows, and refused claims.
- **Routines:** natural variations and low-risk micro-tests with targets, review points, confounds, and stop boundaries; prescription changes are permanently ineligible.
- **Library:** movement, recurring-meal, evidence-language, and medication-boundary references with visible version and provenance state.
- **Data:** source freshness, the intended private topology, exclusions, and the unresolved privacy controls that block real personal ingestion.

All displayed records are dummy data. No health source is connected, no image or document analysis is running, and interactions are held only in browser memory. The prototype demonstrates the intended product contract—not a validated health result or a deployed private system.

## Non-negotiable boundaries

- No diagnosis, medication changes, drug-interaction advice, or judgments about whether a prescription is working.
- No mole, lesion, or pigmented-spot analysis. Capture/document and route to a dermatologist where appropriate.
- No conclusion from a confounded or incomplete data window.
- No public ingress for personal health data.
- Therapy content is not an inference source.
- A nutrition image estimate is an educated range, never a precise nutrient fact.
- A body or skin photo can document visible change under a protocol; it cannot establish internal body composition, diagnose a condition, or determine whether a body is “better.”
