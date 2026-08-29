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

All responses are `no-store`. Errors are `{ "error": string }` with a meaningful
status.

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
  "text": "the mole on my back looks different",   // required, 1–4000 chars
  "attachments": [                                  // optional, max 10
    { "kind": "image", "storagePath": "captures/…", "mimeType": "image/jpeg" }
  ],
  "idempotencyKey": "offline-2026-08-29-0001",      // optional; replay-safe
  "capturedAt": "2026-08-29T12:18:00Z"              // optional; when the user recorded it
}
```

**`201`** on a new write, **`200`** when an `idempotencyKey` has already landed
(`replayed: true`, and no second decision is written).

```jsonc
{
  "userMessageId": "…",
  "advisorMessageId": "…",
  "decisionIds": ["…"],
  "replayed": false,
  "reply": { "text": "…", "kind": "route", "receipt": "Documented for dermatology · not analysed" },
  "decisions": [ /* see below */ ],
  "followUp": "Should I start a dated capture series for this so the change is visible later?",
  "route": "dermatologist",
  "trace": { "ruleId": "skin-lesion" }
}
```

### The decision object

PRD §11.10 requires every output to carry its evidence status and provenance, so
these fields are **not optional**. A client must not render a recommendation
without the label that qualifies it.

| Field | Meaning |
|---|---|
| `evidenceStatus` | One of PRD §4.5's nine statuses |
| `ladderLevel` | PRD §5, `0`–`5` |
| `gateOutcome` | `clear` \| `caveated` \| `blocked` (PRD §8) |
| `gateReason` | Why, in words the user can read |
| `confoundsChecked` | Each confound consulted, with its threshold version |
| `confidenceNote` | Prose. Never a bare number |
| `refused` | What this output explicitly declines to claim |
| `choices` | Offered actions, including a do-nothing option where meaningful |
| `target`, `expectedLag` | What it is for, and when to expect an effect |
| `expiresAt` | When a recommendation stops standing |
| `ruleId`, `advisorVersion` | What produced it |

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
Messages are returned oldest-first.

```jsonc
{
  "messages": [
    { "message_id": "…", "ts": "…", "role": "user", "text": "…",
      "kind": null, "receipt": null, "in_reply_to": null,
      "corrected_by": null, "rule_id": null }
  ]
}
```

`corrected_by` points forward to the message that supersedes this one.
Corrections are non-destructive — the original stays, so what Ashwini believed
at the time survives.

---

## `GET /api/decisions`

Decisions not yet responded to and not yet expired.
`?includeExpired=1` keeps expired ones; `?limit=` (1–100, default 25).

---

## `POST /api/decisions/:id/respond`

Records what the user did. Without it, Ashwini can say what it recommended but
never whether the suggestion was useful, ignored, impossible, or wrong (PRD §9).

```jsonc
{
  "choice": "Reduced volume",
  "note": "shoulder felt fine",
  "wasOverride": false,
  "overrideReason": null
}
```

- A `choice` outside the decision's offered set is rejected **unless**
  `wasOverride` is true.
- `wasOverride` without an `overrideReason` is rejected. PRD §8 requires an
  override to be explicit and permanently retained with the output it affected.
- Responses are append-only. There is no edit and no delete.

---

## Not yet built

`POST /api/interactions/check` (Examine Connect), meals, routines, and captures.
`lib/examine-connect.ts` is hardened and ready; it needs a route and an
`external_results` write. Until then the supplement rule blocks every supplement
question for want of a current authorized result, which is the correct behaviour
under PRD §7.3 rather than a gap to work around.
