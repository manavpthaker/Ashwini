# Ashwini

**A private personal health advisor that turns the current moment into a useful next action.**

Ashwini is organized around check-ins, not chat. The user says what changed once; Ashwini records it, exposes the relevant role-based reasoning perspectives, and returns one coordinated next step when the evidence supports one. Those perspectives are Ashwini synthesis—not people, credentials, separate agents, or proof of provider review.

The working domain is **ashwini.health**. The product does not diagnose, prescribe, or replace clinical care.

## Current product

The synthetic prototype has three real routes:

- **Today — `/`:** the current recommendation, its evidence state, the relevant perspectives, and a compact timeline.
- **Check-in — `/check-in/`:** one intake for food, energy, sleep, pain, medication context, or questions, followed by a structured response and chronological record rather than a chat transcript.
- **Plan — `/plan/`:** the current decision, user-owned plan choice, active routines, weekly review, and contextual evidence/privacy details.

State persists across client-side route changes for the current browser session only. Reloading resets the synthetic scenario. The prototype does not upload attachments, save health data, run a model, query Examine Connect, or imply human review.

The authoritative product contract is [`docs/PRD.md`](docs/PRD.md). Visual, interaction, responsive, accessibility, and language rules are in [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md).

## Synthetic behavior

The scenario reducer is intentionally narrow and deterministic:

- Vague meal input records that lunch occurred and asks for one useful detail; it does not invent calories or protein.
- Only the exact declared `House Dal v1 with rice and yogurt` fixture returns its labeled synthetic range; prefixes and added context do not.
- Pain, urgent-demo phrases, prescription changes, and drug–drug questions block or route out instead of generating a product verdict.
- Active pain and urgent blocks are absorbing until their source record is corrected or undone. A later clear-demo check cannot bypass them.
- A declared unexpected-dose or possible-side-effect event remains the primary Today handoff instead of disappearing behind the routine plan.
- Lower-priority fixture effects are retained behind an open handoff without replacing its response; if the handoff is later corrected, the deferred effect becomes active with its original reasoning attached.
- Supplement questions never imply a live safety check, authorization, queue, or result.
- Unmatched wording is retained without endorsing the existing plan and repeats the urgent/new/severe/worsening human-care boundary; the exact-match demo set is not a safety classifier.
- Corrections can target any active history record, preserve and supersede the original, explicitly report removed effects, and recalculate the session without inventing replacement facts. The latest check-in can be undone.
- A bare correction label cannot supersede a record. An explicit voluntary Pause survives later caution or protective gates and returns after the controlling record is corrected, so the preview never silently resumes loaded training.
- The scenario uses a deterministic synthetic Friday clock. The labeled simulation prompt advances it from 12:18 PM to the 3:45 PM pre-session phase; records never mix the fixture with the machine clock.

This reducer exists to test the product contract. It is not a health reasoning engine.

## Run and verify

```bash
pnpm install
pnpm dev --hostname 127.0.0.1 --port 3010
```

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

`pnpm build` creates a static export in `out/`. `pnpm desktop:build` packages that export with Electron. Production uses the traversal-safe `app://ashwini/` origin so root-relative Next.js assets and the three routes resolve correctly without a local server.

## Production gates

Real personal data remains blocked until the product has verified canonical storage, schema migration, retention and deletion, backup/recovery, source provenance, provider disclosure, and private-network behavior. The existing Electron encrypted-state bridge is a dormant v1 scaffold and is not connected to this interface.

[`lib/examine-connect.ts`](lib/examine-connect.ts) is a future private-service adapter for supplement–drug and supplement–supplement safety interactions. Its credential must never enter the static renderer. Examine Connect does not cover drug–drug interactions, and the prototype performs no live query.
