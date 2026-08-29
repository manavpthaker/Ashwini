# Ashwini

**A private personal health advisor that turns the current moment into a useful next action.**

Ashwini is organized around check-ins, not chat. The user says what changed once; Ashwini records it, exposes the relevant role-based reasoning perspectives, and returns one coordinated next step when the evidence supports one. Those perspectives are Ashwini synthesis—not people, credentials, separate agents, or proof of provider review.

The working domain is **ashwini.health**. The product does not diagnose, prescribe, or replace clinical care.

## What is real

Check-ins are real. Typing one sends it to `POST /api/conversation`, where the rule pipeline in [`domain/advisor/`](domain/advisor) classifies it, the safety boundaries in [`domain/evidence.ts`](domain/evidence.ts) constrain what may be said about it, and the result is written to Postgres inside one transaction. Reload the page and it is still there, because it is a record rather than a component's state. Corrections supersede rather than overwrite, and the database enforces that with triggers instead of trusting the application to be careful.

Still fixtures: routines, the weekly review, and the day timeline on Today and Plan. Photo, voice, and document intake are not wired up, no personal health source is connected, no image or document analysis runs, and no model provider is in use.

The three routes:

- **Today — `/`:** the current recommendation, its evidence state, the relevant perspectives, and a compact timeline.
- **Check-in — `/check-in`:** one intake for food, energy, sleep, pain, medication context, or questions, followed by a structured response and chronological record rather than a chat transcript.
- **Plan — `/plan`:** the current decision, user-owned plan choice, active routines, weekly review, and contextual evidence/privacy details.

The authoritative product contract is [`docs/PRD.md`](docs/PRD.md). Visual, interaction, responsive, accessibility, and language rules are in [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md). The API is documented in [`docs/API.md`](docs/API.md).

## Running it

```bash
pnpm install
pnpm db:apply                       # apply migrations to DATABASE_URL
ASHWINI_ALLOW_SEED=1 pnpm db:seed   # optional synthetic development data
pnpm dev
```

See [`.env.example`](.env.example) for configuration.

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Integration tests need a throwaway Postgres and are skipped without one:

```bash
ASHWINI_TEST_DATABASE_URL=postgres://…/ashwini_test pnpm test
```

## Deploying

The app runs in one of two shapes, and the identity gate picks the right one from what you configure — there is no mode flag.

**Vercel (the current deployment).** Requires Supabase auth: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `ASHWINI_ALLOWED_EMAILS`. The app **refuses to start** on a public host without them, and there is no override — the alternative gate reads a header that only `tailscale serve` can be trusted to set, and on a public host any caller can forge it.

- Use the **transaction-mode pooler, port 6543**. Each serverless invocation may be a fresh process, so pooling has to happen upstream; the pool is capped at one connection per instance.
- `output: "standalone"` is deliberately not set on Vercel. Vercel builds its own output, and forcing standalone alongside a stale project "Output Directory" is what broke the first deployments here.
- [`vercel.json`](vercel.json) runs the reminder scheduler every 15 minutes. This is what satisfies PRD §11.8 — reminders fire whether or not any machine at home is awake — and it needs `ASHWINI_CRON_SECRET`.

**Private host (Mac mini).** Set `ASHWINI_TAILSCALE_USER` instead, reach it through `tailscale serve`, and bind to `127.0.0.1`. Never `tailscale funnel`. Use the **session-mode pooler, port 5432** — also the IPv4-friendly option, since Supabase direct connections are IPv6-only without the add-on. Here `pnpm build` emits a standalone server, which does **not** copy `public/` or `.next/static`:

```bash
cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/
```

Migrations always use the session-mode or direct URL, never 6543.

## Architecture

|                                               |                                                                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`domain/`](domain)                           | Pure. No I/O, no React, no ambient clock. The evidence vocabulary (§4.5), inference ladder (§5), confound gate (§8), and the advisor rule pipeline. Fully covered by tests. |
| [`server/`](server)                           | Everything that touches the outside world. Every file opens with `import "server-only"`.                                                                                    |
| [`app/api/`](app/api)                         | Route handlers. See [`docs/API.md`](docs/API.md).                                                                                                                           |
| [`supabase/migrations/`](supabase/migrations) | Immutable SQL migrations.                                                                                                                                                   |
| `app/`, `components/product/`                 | The three routes. State comes from the API through `components/product/product-provider.tsx`.                                                                               |

The advisor is a deterministic rule pipeline behind an `Advisor` interface, so a model-backed implementation can be swapped in without touching a call site. The safety invariants are enforced centrally in `domain/evidence.ts` and again as database constraints, which is what lets a future model implementation inherit them rather than be trusted to honour them.

### Where the interface meets the advisor

[`lib/checkin-adapter.ts`](lib/checkin-adapter.ts) translates a stored decision object into the view model the screens render, and it is the reason the interface cannot quietly disagree with the safety layer. Every field it produces is read off the decision; where the server established nothing, it sets nothing, so a gate is never invented to fill a slot.

[`lib/synthetic-scenario.ts`](lib/synthetic-scenario.ts) is now two halves and its header says which is which. Its reducer is live: it folds check-in records into the day's state and applies §4.4's absorbing rule, so a safety route-out stays visible until the record behind it is corrected. Its evaluator is not, and must not be reconnected — it classified check-ins by exact-string lookup against a fixture set, which is fine for a mockup and unusable as a safety layer.

## Boundaries the code enforces

- Low-risk lifestyle and performance recommendations are allowed; diagnosis and prescriptions are not.
- Supplement-interaction recommendations require a current authorized source result. Drug–drug and prescription-change questions route to a pharmacist or prescriber — whether or not the medications are on file, since the question is most likely to be asked before they are.
- No mole, lesion, or pigmented-spot analysis. Capture/document and route to a dermatologist where appropriate.
- No conclusion from a confounded or incomplete data window.
- Access is gated by a verified session on an explicit allowlist, never by network position. The app refuses to run on a public host without it. Storage and hosting are both disclosed managed processors — see [`docs/PRIVACY.md`](docs/PRIVACY.md) and PRD §4.8.
- Therapy content is not an inference source: the mention is recorded, the text is not.
- A nutrition image estimate is an educated range, never a precise nutrient fact. `meals` has no scalar `kcal` column, only `kcal_low` and `kcal_high`.
- A body or skin photo can document visible change under a protocol; it cannot establish internal body composition, diagnose a condition, or determine whether a body is "better."

## Examine Connect

[`lib/examine-connect.ts`](lib/examine-connect.ts) is the server-side adapter for Examine Connect's supplement–drug and supplement–supplement interaction endpoint. It opens with `import "server-only"`, so importing it from a client component is a build error rather than a convention; `EXAMINE_CONNECT_API_KEY` is a server credential and never reaches a browser bundle. The adapter disables fetch caching, times out at 8 seconds, and retries once — only for transient failures, never a 4xx.

Results are persisted to `ashwini.external_results` with the provider, query time, evidence grade, references, and licence constraints that PRD §7.7 requires. Failed and empty checks are stored too: a missing result must read as "not checked", never as "nothing found". Any production cache must honour Examine's current licence and cache policy — the TTL lives in the row, not in code.

Until the check route exists, the supplement rule blocks every supplement question for want of a current authorized result. Under PRD §7.3 that is the correct behaviour rather than a gap: silence is not evidence that no interaction exists.

## Electron

Parked. [`desktop/static-protocol.cjs`](desktop/static-protocol.cjs) and its traversal tests are kept because the path-safety logic is worth keeping, but the packaged build assumed a static export in `out/`, which no longer exists — route handlers cannot be statically exported, and they are the whole API. If the desktop shell returns it loads the running app over HTTPS rather than from disk. The Electron encrypted-state bridge is a dormant v1 scaffold and is not connected to this interface.
