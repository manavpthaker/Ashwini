# Ashwini Design System

**Version:** 0.5
**Status:** Implemented for the synthetic Today / Check-in / Plan prototype

## Product expression

Ashwini should feel like an attentive multidisciplinary consult distilled into one calm recommendation. It is not a generic wellness dashboard, medical portal, or provider-role-play chat.

The interaction sequence is:

> Acknowledge → interpret carefully → recommend or route out → ask at most one useful follow-up → preserve the decision record

Warmth is an interaction standard, not a source of authority. Never use bedside manner to hide uncertainty, imply human review, or soften a necessary block.

## Information architecture

Only three destinations are primary:

| Surface | Job | First-viewport requirement |
|---|---|---|
| Today | Make the current moment legible | One recommendation, status, immediate action, and next decision time |
| Check-in | Capture what changed once | One open intake; no provider or domain selection |
| Plan | Preserve commitments and accountability | Current decision, explicit user choice, active routines, and review state |

Review belongs inside Plan. Evidence appears beside the claim it qualifies. Privacy and system-readiness details are secondary context, not peer navigation.

## Visual language

The system pairs an editorial display face with a highly legible sans serif:

- **Display:** Newsreader; recommendation headlines, section headlines, and the wordmark.
- **Interface/body:** Instrument Sans; navigation, body copy, controls, metadata, and status labels.

Both are loaded through `next/font` and self-hosted in the production build. Body copy starts at `1rem`; the smallest visible text is `0.75rem` and is reserved for short metadata or status labels. Do not return to the previous 7–10 px interface copy.

### Color roles

| Token | Value | Role |
|---|---:|---|
| `--color-ink` | `#14231f` | Primary text, dark surfaces, selected navigation |
| `--color-canvas` | `#f7f9f6` | Application background |
| `--color-surface` | `#fcfefc` | Cards and raised controls |
| `--color-mist` | `#e7efea` | Quiet fills and hover states |
| `--color-coral` | `#f26f55` | Primary action and nutrition path |
| `--color-indigo` | `#4658d8` | Recovery path and keyboard focus |
| `--color-moss` | `#27735e` | Training path and bounded-guidance state |
| `--color-gold` | `#d9a72e` | Caution and synthetic-preview state |
| `--color-route` | `#a63e46` | Route-out and blocked state |

Coral is an action color, not default body text. Status colors always include a text label; meaning never depends on color alone.

### Spacing, shape, and depth

- Spacing uses the `0.25rem` through `4rem` token scale in `app/globals.css`.
- Interactive controls are at least `44px`; primary controls are `50px`.
- Corners are softly geometric, generally `10–20px`; pills are reserved for compact statuses.
- Shadows indicate a floating control or major raised panel. Borders, spacing, and background tone provide most hierarchy.
- The content frame is capped at `80rem`.

## Signature component: consultation path

The converging three-line path is Ashwini’s distinctive explanatory motif. Nutrition, recovery, and training enter as separate evidence-colored paths, converge into one current recommendation, and continue to the next check-in. It communicates multidisciplinary reasoning without inventing a cast of providers.

Use it only when two or more perspectives materially affect one decision. Do not decorate unrelated cards with it.

## Components

### Buttons

- **Primary:** the one immediate action on a surface.
- **Secondary:** explanation or a reversible adjacent action.
- **Quiet:** low-priority record management and navigation.
- **Danger:** a consequential route-out action; not a general warning treatment.

Every visible action must change state, navigate, disclose information, or produce an honest receipt. Remove no-op actions. Unavailable photo, voice, and document modes must explicitly say they are not connected and that nothing was uploaded.

### Status labels

Statuses describe epistemic or gate state: Recorded, Rule-based, Tracking, Early signal, Blocked, or Route out. Keep the label attached to the relevant claim. Never use a reassuring color as a substitute for the label and basis.

### Perspective cards

A perspective card contains a reasoning domain, participation state, concise contribution, and a visible boundary. It never has a portrait, personal name, credential, typing indicator, speech bubble, or first-person provider voice. The canonical origin is `ashwini_synthesis`.

### Check-in response

Responses use four stable sections: Acknowledged, Careful read, Next step, and—only when necessary—One follow-up. A details disclosure preserves what was recorded, status, gate, and receipt. Corrections link to the original, mark it superseded, and state when a prior effect was withdrawn; undo removes only the latest synthetic event.

### Decision choice

Plan choices use native buttons with `aria-pressed`. A blocked gate or open high-priority handoff exposes Pause as the forced protective state and disables every plan choice; it never attributes that state to the user. Outside a gate, Ashwini records a changed user selection but does not restate it as clinical clearance. Activating the already-effective rule selection is idempotent and does not displace a higher-priority open input on Today.

## State integrity

- Safety blocks are absorbing while their source records remain active. Later routine or clear-demo inputs cannot overwrite them or replace the primary Check-in response.
- Unexpected-dose and possible-side-effect fixtures create a separate high-priority attention state. That handoff remains primary on Today until its source record is corrected or undone.
- Valid lower-priority fixture effects may be retained behind a protected response. If the controlling handoff is later corrected, its deferred effect must surface with the original receipt and reasoning perspectives—not with stale handoff provenance.
- Nonurgent prescription and supplement questions retain their own route-out response without replacing an unrelated current-day decision.
- Corrections preserve the source record, supersede its derived effect, and produce a receipt that matches the recalculated state.
- The preview uses a deterministic synthetic clock. Only the explicitly labeled pre-session simulation advances Friday from 12:18 PM to 3:45 PM.
- Correcting a pre-session record may change its derived effect, but it never rewinds the visible scenario clock.
- User plan choices survive unrelated record-only check-ins and their undo. Gate changes invalidate a prior Full or Reduced choice, but an explicit voluntary Pause remains stored through a protective handoff and reappears after that handoff is corrected or undone; Ashwini never silently resumes loaded training.

## Responsive behavior

Desktop uses a persistent top bar with centered Today / Check-in / Plan navigation. At `760px` and below, primary navigation becomes a fixed three-item bottom bar with safe-area padding and at least `52px` per target.

Mobile rules:

- Keep the immediate recommendation or intake inside the first viewport.
- Never stack a taxonomy or several category tabs above core content.
- Perspective cards may form a horizontal snap row with a visible next-card edge; the page itself must not overflow horizontally.
- Preserve at least `12px` side gutters and bottom clearance for fixed navigation.
- Prefer one-column reading order; do not miniaturize desktop controls.

## Accessibility

- Target WCAG 2.2 AA contrast for all text and controls.
- Use semantic `header`, `nav`, `main`, `section`, `aside`, `details`, and native form controls.
- Provide a skip link and one `h1` with `id="page-title"` per route.
- Move focus to the route heading after client-side navigation.
- Keep a visible 3px indigo focus ring.
- Announce only concise receipts through live regions; never wrap the entire check-in history in `aria-live`.
- Respect `prefers-reduced-motion`.
- Do not rely on hover, color, or horizontal scrolling as the only route to information.

## Content and safety language

Use “Check-in,” “perspective,” “coordinated recommendation,” and “human specialist.” Avoid “conversation,” “care team,” “your doctor says,” “provider replied,” “consensus,” or any claim that separate agents independently reviewed the input.

A check-in may yield a record, one follow-up, a recommendation, a blocked verdict, or a route-out. It does not owe the user advice every time.

Always distinguish:

- user-reported from verified;
- a declared synthetic fixture from a fresh analysis;
- a rule from a personal pattern;
- a pattern from causality;
- Ashwini synthesis from human professional judgment;
- session-only preview state from saved personal data.

## Global commercial readiness

This design direction targets commercial product quality, but the synthetic prototype is not globally release-ready. A real release must:

- format dates, times, numbers, units, and week boundaries from the user’s locale and preferences rather than hard-code US conventions;
- support translation expansion without truncating controls or placing essential copy inside images;
- localize emergency and specialist-routing language to the user’s jurisdiction instead of assuming one health system;
- verify keyboard, screen-reader, reduced-motion, zoom, high-contrast, and 320 px behavior in every supported language;
- resolve consent, age eligibility, data residency, retention, deletion, support, and provider-disclosure requirements per launch market.

These are release gates, not reasons to make the current interface look like an internal tool.

## Implementation map

- Global tokens and primitives: `app/globals.css`
- React primitives: `components/design-system/ui.tsx`
- Shell and primary navigation: `components/product/product-shell.tsx`
- Today: `components/product/today-screen.tsx`
- Check-in: `components/product/checkin-screen.tsx`
- Plan: `components/product/plan-screen.tsx`
- Typed product contract: `lib/product-model.ts`
- Declared fixtures: `lib/product-data.ts`
- Deterministic preview behavior: `lib/synthetic-scenario.ts`

New components must reuse semantic tokens before adding local values. If a local value recurs across two surfaces, promote it to a token or shared primitive.
