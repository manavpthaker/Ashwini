# Ashwini

**A private personal health advisor that turns the current moment into a useful next action.**

Ashwini behaves like one continuous conversation with a team that knows the user: primary-care navigation, nutrition, training, recovery, and personal experimentation in one place. It can make bounded working inferences and practical recommendations in low-risk, reversible domains. Clinical decisions, urgent or escalating symptoms, diagnosis, and prescription changes become specialist handoffs.

The working product/domain name is **ashwini.health**. Ashwini invokes the Ashvins: the Vedic physicians associated with dawn and healing. The product does not diagnose, prescribe, or replace clinical care.

## Product definition

The current product direction is locked in [`docs/PRD.md`](docs/PRD.md).

Its central interaction is:

1. Open to the current time of day and see the immediate call.
2. Say what happened or ask a question in one conversational intake.
3. Let Ashwini route the input into the right structured record.
4. Get a recommendation, the basis for it, and the next fact that could change it.
5. Follow up, review personal patterns, and involve a specialist when the decision requires one.

The goal is a durable working relationship—not another dashboard or collection of disconnected capture modes.

## Repository status

The PRD remains the authority. The repository is now in two halves, and the split is worth understanding before reading either.

**The foundation is real.** Postgres-backed storage on Supabase, a validated server, an identity-gated API, and a tested safety layer that enforces the PRD's boundaries in code rather than describing them in copy. `pnpm test` runs it; `docs/API.md` documents it.

**The interface is still the synthetic prototype**, and a redesign is in progress separately. It has not yet been connected to the API below — it renders fixtures from `lib/demo-data.ts` and holds its state in browser memory. The "Demo workspace" flag is accurate for every surface it shows.

So: no personal health source is connected, no image or document analysis runs, and no model provider is in use. What has changed since the prototype is that the record underneath is real, and the safety rules are enforced rather than narrated.

## Running it

```bash
pnpm install
pnpm db:apply                    # apply migrations to DATABASE_URL
ASHWINI_ALLOW_SEED=1 pnpm db:seed   # optional synthetic development data
pnpm dev
```

See [`.env.example`](.env.example) for configuration.

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

Integration tests need a throwaway Postgres and are skipped without one:

```bash
ASHWINI_TEST_DATABASE_URL=postgres://…/ashwini_test pnpm test
```

## Architecture

|                                               |                                                                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`domain/`](domain)                           | Pure. No I/O, no React, no ambient clock. The evidence vocabulary (§4.5), inference ladder (§5), confound gate (§8), and the advisor rule pipeline. Fully covered by tests. |
| [`server/`](server)                           | Everything that touches the outside world. Every file opens with `import "server-only"`.                                                                                    |
| [`app/api/`](app/api)                         | Route handlers. See [`docs/API.md`](docs/API.md).                                                                                                                           |
| [`supabase/migrations/`](supabase/migrations) | Immutable SQL migrations.                                                                                                                                                   |
| `app/`, `components/`                         | The prototype interface, pending redesign.                                                                                                                                  |

The advisor is a deterministic rule pipeline behind an `Advisor` interface, so a model-backed implementation can be swapped in without touching a call site. The safety invariants are enforced centrally in `domain/evidence.ts` and again as database constraints, which is what lets a future model implementation inherit them rather than be trusted to honour them.

## The prototype interface

Still fixture-backed, pending the redesign. It demonstrates these surfaces:

- **Now:** a Friday-midday shift brief driven by what is known, what is missing, and what is scheduled next.
- **Conversation:** one continuous intake for food, sleep, training, medication, symptoms, photos, documents, corrections, and questions.
- **Recommendations:** interactive dummy reasoning that updates the live plan for meals, fatigue, training, symptoms, and supplement research.
- **Review:** training, nutrition, body/aesthetic, mood/focus, and medication records with explicit evidence labels, confound gates, comparable windows, and refused claims.
- **Plan:** natural variations and low-risk routines with targets, review points, confounds, and stop boundaries.
- **Evidence:** personal learning, movement and meal references, evidence language, and an integration-ready Examine Connect source contract.
- **Data:** source freshness, intended private topology, exclusions, and unresolved privacy controls that block real personal ingestion.

Every record it displays is dummy data. It opens as a lived-in Month 2 workspace after more than 30 days of activity, and its interactions are held only in browser memory — none of it reaches the API or the database yet. Connecting these surfaces to `/api` is the next piece of work.

## Non-negotiable boundaries

- Low-risk lifestyle and performance recommendations are allowed; diagnosis and prescriptions are not.
- Supplement-interaction recommendations require a current authorized source result. Drug–drug and prescription-change questions route to a pharmacist or prescriber.
- No mole, lesion, or pigmented-spot analysis. Capture/document and route to a dermatologist where appropriate.
- No conclusion from a confounded or incomplete data window.
- Access is gated by a verified session on an explicit allowlist, never by network position. The app refuses to run on a public host without it. Storage and hosting are both disclosed managed processors — see [`docs/PRIVACY.md`](docs/PRIVACY.md) and PRD §4.8, amended in v0.5 when storage moved off the Mac mini and again in v0.6 when the app itself did.
- Therapy content is not an inference source.
- A nutrition image estimate is an educated range, never a precise nutrient fact.
- A body or skin photo can document visible change under a protocol; it cannot establish internal body composition, diagnose a condition, or determine whether a body is “better.”

## Examine Connect

[`lib/examine-connect.ts`](lib/examine-connect.ts) is the server-side adapter for Examine Connect’s supplement–drug and supplement–supplement interaction endpoint. It opens with `import "server-only"`, so importing it from a client component is a build error rather than a convention; `EXAMINE_CONNECT_API_KEY` is a server credential and never reaches a browser bundle. The adapter disables fetch caching, times out at 8 seconds, and retries once — only for transient failures, never a 4xx.

Results are persisted to `ashwini.external_results` with the provider, query time, evidence grade, references, and licence constraints that PRD §7.7 requires. Failed and empty checks are stored too: a missing result must read as "not checked", never as "nothing found". Any production cache must honour Examine’s current licence and cache policy — the TTL lives in the row, not in code.

Until the check route exists, the supplement rule blocks every supplement question for want of a current authorized result. Under PRD §7.3 that is the correct behaviour rather than a gap: silence is not evidence that no interaction exists.

Examine Connect does not cover drug–drug interactions. Efficacy and dosing require separate licensing, so the product must not present the safety endpoint as a general medical-research API.
