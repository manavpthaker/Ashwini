# Ashwini Design System

**Version:** 0.6
**Status:** Implemented for the authenticated, record-backed Today / Check-in / Plan product

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
| `--color-gold` | `#d9a72e` | Caution and pending state |
| `--color-route` | `#a63e46` | Route-out and blocked state |

Coral is an action color, not default body text. Status colors always include a text label; meaning never depends on color alone.

### Spacing, shape, and depth

- Spacing uses the `0.25rem` through `4rem` token scale in `app/globals.css`.
- Interactive controls are at least `44px`; primary controls are `50px`.
- Corners are softly geometric, generally `10–20px`; pills are reserved for compact statuses.
- Shadows indicate a floating control or major raised panel. Borders, spacing, and background tone provide most hierarchy.
- The content frame is capped at `80rem`.

## Signature component: consultation path

The evidence path is Ashwini’s distinctive explanatory motif. Only persisted decision domains may enter it; one domain is one path, and multiple relevant domains may converge into one current recommendation. It communicates inspectable reasoning without inventing a cast of providers.

Use it only when a saved decision has a reasoning perspective. An empty record gets an explicit no-inference state, not decorative evidence paths.

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

Responses use three stable sections: Acknowledged, Careful read, and Next step. A details disclosure preserves what was recorded, status, gate, and receipt. Corrections link to the original and visibly supersede it without deletion. A later check-in is evaluated as a new input; the current release does not imply a threaded provider conversation.

### Decision choice

Plan renders the exact choices stored with the unresolved decision. Each native button is a write action, not a local toggle: activation appends one `decision_responses` row, removes the answered decision from the open list, and shows the server-backed receipt. A blocked route-out with no offered choices exposes no invented dismissal or training control.

## State integrity

- Today prioritizes unresolved emergency or crisis route-outs, then other route-outs, then blocked decisions, then the newest actionable recommendation.
- A corrected check-in remains in history, but its prior decision is excluded from the open-decision surface.
- Responded and expired decisions are not actionable. A response is durable; browser state is never the source of a plan choice.
- Current-day timelines use the configured time zone and only stored rows. A database failure renders unavailable, never an inferred empty or clear day.
- Missing meals, sleep, doses, commitments, training sessions, routines, and reviews remain unknown. The interface does not seed a default day.

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

A check-in may yield a record, a recommendation, a blocked verdict, or a route-out. It does not owe the user advice every time.

Always distinguish:

- user-reported from verified;
- a saved record from an unavailable or unknown input;
- a rule from a personal pattern;
- a pattern from causality;
- Ashwini synthesis from human professional judgment;
- an interface empty state from saved personal data.

## Global commercial readiness

This design direction targets commercial product quality, but the current single-subject record-backed app is not globally release-ready. A real release must:

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
- Record client contracts: `lib/record-client.ts`
- Historical prototype-only behavior: `lib/synthetic-scenario.ts`

New components must reuse semantic tokens before adding local values. If a local value recurs across two surfaces, promote it to a token or shared primitive.
