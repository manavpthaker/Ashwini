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

This is a product-design repository with a **full-scope synthetic product prototype**. The PRD remains the authority; the interface demonstrates its major surfaces and boundaries without implying that ingestion, storage, model inference, or private infrastructure is already operational.

The prototype includes:

- **Now:** a Friday-midday shift brief driven by what is known, what is missing, and what is scheduled next.
- **Conversation:** one continuous intake for food, sleep, training, medication, symptoms, photos, documents, corrections, and questions.
- **Recommendations:** interactive dummy reasoning that updates the live plan for meals, fatigue, training, symptoms, and supplement research.
- **Review:** training, nutrition, body/aesthetic, mood/focus, and medication records with explicit evidence labels, confound gates, comparable windows, and refused claims.
- **Plan:** natural variations and low-risk routines with targets, review points, confounds, and stop boundaries.
- **Evidence:** personal learning, movement and meal references, evidence language, and an integration-ready Examine Connect source contract.
- **Data:** source freshness, intended private topology, exclusions, and unresolved privacy controls that block real personal ingestion.

All displayed records are dummy data. The interface opens as a lived-in Month 2 workspace after more than 30 days of activity. No personal health source is connected, no image or document analysis is running, and interactions are held only in browser memory. The Examine Connect adapter is implemented for the future private service, but no credential or live result is included in the prototype.

## Non-negotiable boundaries

- Low-risk lifestyle and performance recommendations are allowed; diagnosis and prescriptions are not.
- Supplement-interaction recommendations require a current authorized source result. Drug–drug and prescription-change questions route to a pharmacist or prescriber.
- No mole, lesion, or pigmented-spot analysis. Capture/document and route to a dermatologist where appropriate.
- No conclusion from a confounded or incomplete data window.
- No public ingress for personal health data.
- Therapy content is not an inference source.
- A nutrition image estimate is an educated range, never a precise nutrient fact.
- A body or skin photo can document visible change under a protocol; it cannot establish internal body composition, diagnose a condition, or determine whether a body is “better.”

## Examine Connect

[`lib/examine-connect.ts`](lib/examine-connect.ts) defines the private-service adapter for Examine Connect’s supplement–drug and supplement–supplement interaction endpoint. Configure `EXAMINE_CONNECT_API_KEY` only on the private service; the static client must never receive it. The adapter intentionally disables fetch caching. Any production cache must honor Examine’s current license and cache policy.

Examine Connect does not cover drug–drug interactions. Efficacy and dosing require separate licensing, so the product must not present the safety endpoint as a general medical-research API.
