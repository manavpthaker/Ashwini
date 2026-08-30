# API

Same-origin, under `/api`. There is no separate API host and no
`NEXT_PUBLIC_API_URL` — the client calls relative paths, so nothing about the
private hostname is compiled into the bundle.

Every request passes the identity gate in `proxy.ts` first. From a browser on
the tailnet that is automatic, because `tailscale serve` injects the header.
From `curl` on the host itself you have to supply it:

```bash
curl -H 'Tailscale-User-Login: you@example.com' http://127.0.0.1:3000/api/health
```

All responses are `no-store`. Record-bearing routes verify the principal again
inside the handler as defence in depth; proxy matching is not their only gate.

---

## `GET /api/health`

Liveness plus real database reachability — they are different questions.

```json
{ "status": "ok", "database": "reachable", "latencyMs": 13 }
```

`503` with `"status": "degraded"` when the database cannot be reached.

---

## `POST /api/conversation`

The single conversational intake (PRD §4.3). Everything the user says enters
here; Ashwini decides what it becomes.

```jsonc
{
  "text": "the mole on my back looks different", // required, 1–4000 chars
  "attachments": [], // reserved; non-empty returns 501 today
  "idempotencyKey": "offline-2026-08-29-0001", // optional; replay-safe
  "capturedAt": "2026-08-29T12:18:00Z", // optional; when the user recorded it
}
```

**`201`** on a new write, **`200`** when an `idempotencyKey` has already landed
(`replayed: true`, and no second decision is written).

```jsonc
{
  "userMessageId": "…",
  "userText": "…", // durable text, or a neutral marker when content was discarded
  "timeZone": "America/New_York",
  "ts": "2026-08-29T12:18:00.000Z",
  "advisorMessageId": "…",
  "decisionIds": ["…"],
  "replayed": false,
  "reply": { "text": "…", "kind": "route", "receipt": "Dermatology route recorded · not analysed" },
  "decisions": [/* see below */],
  "followUp": null,
  "route": "dermatologist",
  "trace": { "ruleId": "skin-lesion" },
}
```

A replay returns the stored reply and decisions; it never reruns the advisor
against newer context. Reusing a key for different non-redacted wording returns
`409`. Crisis and therapy wording is discarded before persistence, so those
turns retain only a neutral event marker.

### The decision object

PRD §11.10 requires every output to carry its evidence status and provenance, so
these fields are **not optional**. A client must not render a recommendation
without the label that qualifies it.

| Field                      | Meaning                                                         |
| -------------------------- | --------------------------------------------------------------- |
| `evidenceStatus`           | One of PRD §4.5's nine statuses                                 |
| `ladderLevel`              | PRD §5, `0`–`5`                                                 |
| `gateOutcome`              | `clear` \| `caveated` \| `blocked` (PRD §8)                     |
| `gateReason`               | Why, in words the user can read                                 |
| `confoundsChecked`         | Each confound consulted, with its threshold version             |
| `confidenceNote`           | Prose. Never a bare number                                      |
| `refused`                  | What this output explicitly declines to claim                   |
| `choices`                  | Offered actions, including a do-nothing option where meaningful |
| `target`, `expectedLag`    | What it is for, and when to expect an effect                    |
| `expiresAt`                | When a recommendation stops standing                            |
| `ruleId`, `advisorVersion` | What produced it                                                |

**`route`** is non-null when the output leaves Ashwini's scope: `emergency`,
`crisis_line`, `clinician`, `pharmacist`, `prescriber`, `dermatologist`. A
route-out is always `evidenceStatus: "route_out"` at ladder level 5.

**A blocked gate carries no verdict.** When `gateOutcome` is `blocked`,
`evidenceStatus` is only ever `unusable` or `route_out` — enforced in the domain
layer and again by a database check constraint. Render `gateReason` rather than
inventing a fallback.

---

## `GET /api/conversation`

`?limit=` (1–200, default 50) and `?before=` (ISO timestamp) for paging.
Turns are returned oldest-first. A turn keeps the user message, stored reply,
decision, routed record kinds, and route-out together so reload cannot lose the
gate attached to the text.

```jsonc
{
  "timeZone": "America/New_York",
  "turns": [
    {
      "userMessage": { "messageId": "…", "ts": "…", "text": "…", "correctedBy": null },
      "reply": { "text": "…", "kind": "question", "receipt": "…" },
      "decisions": [/* decision fields */],
      "records": ["meal"],
      "followUp": null,
      "route": null,
    },
  ],
}
```

`corrected_by` points forward to the message that supersedes this one.
Corrections are non-destructive — the original stays, so what Ashwini believed
at the time survives.

---

## `GET /api/decisions`

Actionable decisions not yet responded to and not yet expired. An ordinary
record-only output with no choices and no route remains in history but is not
misrepresented as an open action. Safety routes and data-quality blocks remain
until acknowledged. A decision whose source check-in was corrected remains in
append-only history but is excluded here.
`?includeExpired=1` keeps expired ones; `?limit=` is 1–100, default 100.

The response is camel-cased for the product and includes `decisionId`,
`createdAt`, the full evidence/gate/provenance fields, exact `choices`, the stored
advisor `reply`, and `sourceMessageId`. Results are safety-prioritized:
emergency/crisis route-outs, other route-outs, blocked decisions, then newest
actionable recommendations.

---

## `POST /api/decisions/:id/respond`

Records what the user did. Without it, Ashwini can say what it recommended but
never whether the suggestion was useful, ignored, impossible, or wrong (PRD §9).

```jsonc
{
  "choice": "Reduced volume",
  "note": "shoulder felt fine",
  "wasOverride": false,
  "overrideReason": null,
}
```

- A `choice` outside the decision's offered set is rejected **unless**
  `wasOverride` is true.
- `wasOverride` without an `overrideReason` is rejected. PRD §8 requires an
  override to be explicit and permanently retained with the output it affected.
- Responses are append-only. There is no edit and no delete.
- A second response to the same decision returns `409`, including concurrent
  attempts; the database enforces one response per decision.
- Expired decisions and decisions superseded by a corrected source check-in
  return `409` from stale tabs as well as being absent from the open list.

A no-choice safety route or data-quality block may instead be acknowledged:

```jsonc
{ "acknowledge": true }
```

This stores the immutable response `Acknowledged` and closes the prompt. It does
not create an outcome, contact a provider, or mark the underlying concern
resolved.

---

## `GET /api/today`

Returns the configured-zone calendar day and only rows actually stored for that
day: commitments, scheduled/taken doses joined to medication identity, meals,
and training sessions. It also returns `timeZone`, `generatedAt`, and
`partOfDay`. Empty arrays mean no corresponding record; the route never seeds a
default meal, sleep value, dose, or session.

---

## `GET /api/plan`

Returns the configured `timeZone`, active, candidate, and paused routine records, exact occurrence counts,
the latest occurrence, and the latest saved review for each returned routine.
Open decisions remain on `GET /api/decisions`. Empty arrays mean no routine or
review has been recorded.

---

## Not yet built

`POST /api/interactions/check` (Examine Connect), routine creation/editing,
commitment setup, medication-to-dose matching, attachments, handoff generation,
and captures.
`lib/examine-connect.ts` is hardened and ready; it needs a route and an
`external_results` write. Until then the supplement rule blocks every supplement
question for want of a current authorized result and explicitly says no runner
is connected.
