# ashwini Product Requirements Document

**Status:** Product direction locked; reference-layer scaffold authorized

**Version:** 0.3

**Working domain:** `ashwini.health`
**Audience:** One person—the owner of the data and the decision-maker

## 1. Product thesis

ashwini is a private, single-subject health instrument and contextual learning library.

It turns a messy stream of body, training, nutrition, medication-adherence, and standardized visual data into a small number of decisions and personal learning routines. It also keeps the practical reference material needed to understand a task—such as muscle groups, movement patterns, training vocabulary, and personal meal references—inside the same private system. It does not surface observations merely because they are available. It does not diagnose. It does not impersonate a clinician.

The organizing constraint is:

> Anything Ashwini says must either change what happens next or protect the user from drawing a false conclusion.

The product is best understood as an **evidence router**, not an omniscient inference engine. It records reality, evaluates whether the available evidence is usable, recognizes patterns worth testing, supports small low-risk routines, and routes higher-stakes matters to the appropriate human professional.

## 2. The user problem

Personal health data currently fails in two opposite ways:

- It is fragmented across a scale, wearables, photos, apps, memories, messages, and medical documents.
- When collected, it becomes an endless dashboard of observations that does not clarify what to do.

The user wants to learn from daily life without turning life into clinical research or accepting false precision. They need a system that can distinguish a one-off fluctuation from a repeating pattern, propose an intentional comparison when appropriate, and make uncertainty visible at every stage.

## 3. Product outcome

Ashwini should create a sustainable habit:

> Notice → label uncertainty → make one small adjustment → compare under similar conditions → keep, reject, or defer.

Success is not the number of metrics collected. Success is a small set of routines the user has reason to believe work better for their stated goals.

## 4. Core product principles

### 4.1 Decisions, not observations

“HRV fell 12%” is an observation. It is usually noise.

“A high-volume session is scheduled after three low-recovery days. Keep it, cut volume under the pre-agreed rule, or swap to mobility?” is a decision.

Ashwini speaks only for a clear decision, a necessary data-quality block, an agreed scheduled review, or a safety route-out.

### 4.2 The epistemic status must be visible

Every meaningful output carries a label. A guess cannot become a fact by repeated display.

| Status | Meaning | Allowed language |
|---|---|---|
| Recorded | A source says this occurred. | “You logged two afternoon sessions.” |
| Unusable | Data quality or confounds prevent interpretation. | “No verdict: this window is contaminated.” |
| Rule-based | An agreed rule applies to current facts. | “The recovery rule is active.” |
| Noticed | A natural variation is worth retaining. | “You ate earlier than usual before this session.” |
| Tracking | The user is deliberately repeating a small routine. | “Day 2 of the pre-training meal routine.” |
| Early signal | A small pattern appears, with material uncertainty. | “Both comparable sessions went better; too early to call.” |
| Consistent pattern | A relationship recurs across comparable clean windows. | “This has recurred across six comparable sessions.” |
| Personally useful | A repeated, safe comparison supports retaining a routine. | “This routine was more reliable for the defined target.” |
| Route out | The system must defer to a clinician, pharmacist, or dermatologist. | “Documented for a clinician handoff; Ashwini will not interpret this.” |

### 4.3 Daily learning is real; daily verdicts are not

Not every learning routine must be a formal randomized N-of-1 trial. The product may help the user run informal, low-risk **micro-tests** and remember naturally occurring variations.

It must not call a result after two days merely because two days look promising. Daily actions create evidence; weekly or protocol-based reviews interpret it. Formal comparison is reserved for questions that are important, safely reversible, measurable, and repeatable.

### 4.4 Slow systems require slow reviews

Fast outcomes—such as a workout’s completion, a simple adherence behavior, or an immediate routine outcome—may be compared over sessions or days. Training progression, body aesthetics, skin, hair, and labs require the time scale of the underlying system. Daily photos may validate a capture protocol, but cannot establish daily biological change.

### 4.5 Privacy is a product property

The default topology remains private: the iPhone captures; a private Mac mini service holds canonical data and handles scheduled work; Obsidian, if used, is rendered output rather than the source of truth. There is no public ingress. The implementation must define encryption, backup, retention, access controls, offline-data handling, and model-provider disclosure before personal data is ingested.

### 4.6 Knowledge is an asset, not an inference

ashwini keeps concise, versioned reference assets so the user does not have to leave the product to understand a movement, muscle group, measurement, food-estimate caveat, or evidence label. Reference material is educational context; it is never silently promoted to a conclusion about the user's body, symptoms, medication, or treatment.

Every reference asset carries its asset type, source/provenance, version, review status, and appropriate safety boundary. Personal notes may be attached to an asset, but they remain recorded user context—not evidence that the asset is personally effective or medically appropriate.

The product prioritizes context over a broad content feed: show the relevant reference at the point of a decision, capture, plan, or review. The library remains available for intentional browsing without becoming a fourth stream of notifications.

## 5. Inference ladder

Ashwini must stay on the appropriate rung for the available evidence.

| Level | Honest inference | Example | Product action |
|---|---|---|---|
| 0 | Recorded fact | “Three upper-body sessions were logged this week.” | Store; normally stay silent. |
| 1 | Data-quality fact | “Dose adherence and travel made this comparison unreadable.” | Block a verdict. |
| 2 | Operational inference | “Today’s scheduled workload conflicts with your pre-agreed recovery rule.” | Offer a constrained choice. |
| 3 | Observed association | “Late caffeine and lower next-day focus responses recur in clean windows.” | Propose a hypothesis or micro-test. |
| 4 | Personal comparison result | “Across repeated comparable periods, routine A supported the defined target more reliably than B.” | Suggest retaining the routine. |
| 5 | Clinical routing | “This medication or lesion question needs a professional.” | Document and route out; do not interpret. |

No Level 3 association may be presented as Level 4 causality. No Level 4 result may be generalized beyond the user, intervention, target, and observation window that produced it.

## 6. The daily-learning loop

### 6.1 Natural variation

The user did something differently because life happened: ate before an afternoon session, had late coffee, worked late, walked after lunch, or used a different meal routine. Ashwini records the variation and retains it as context. It does not invent a conclusion.

### 6.2 Micro-test

The user deliberately repeats one small, low-risk behavior for a stated purpose. Examples include a pre-training meal routine, a caffeine cutoff, a prepared protein fallback, or a post-lunch walk.

Every micro-test has:

- A single behavior to repeat or compare
- A target outcome the user cares about
- An expected time-to-effect
- A stated review point
- Known confounds and conditions that make a comparison unreadable
- A stop or route-out boundary where appropriate

The product may say “tracking” or “early signal” during the routine. It does not say “worked” until enough comparable evidence exists for the declared question.

### 6.3 Formal personal comparison

Some questions should move from an informal routine to a more deliberate comparison. This is appropriate only when the intervention is low-risk, reversible, repeatable, and has a frequently measurable outcome. The product defines the comparator, repeated periods, washout where relevant, and interpretation threshold in advance.

Prescription medication, urgent symptoms, irreversible actions, and high-stakes health choices are permanently ineligible.

### 6.4 Baseline stabilization before training restarts

When the user has not yet resumed exercise, ashwini does not fabricate a training or recovery loop. The initial routine may instead comprise two parallel daily practices:

- **Medication adherence:** record scheduled and actual adherence to the existing prescription schedule. It is a protected record and potential confound signal, never an experiment variable.
- **Diet anchor:** repeat one small, sustainable nutrition behavior, such as a known protein fallback or a recurring meal pattern. It may be tracked as a low-risk routine with a stated target and review point.

These practices may appear together in Today as a single daily stabilization ritual, but their data and interpretation remain separate. Training begins only after an actual restart date and an agreed plan or logging protocol exist; before then, ashwini may preserve relevant context and reference material but makes no performance, recovery, or exercise-effect claim.

## 7. Initial learning domains

### 7.1 Training and recovery

**Purpose:** Help the user run and adapt an agreed training plan under known constraints.

**Possible outputs:**

- A training verdict is blocked because recovery, sleep debt, travel, illness, or adherence made the window unusable.
- A planned session activates a previously agreed recovery rule.
- A specific training or pre-training routine is ready for a low-risk comparison.
- A weekly progression call is supported by a clean seven-day or block-level summary.

**Never:** diagnose injury, attribute performance change to a medical cause, or replace professional coaching/clinical judgment.

### 7.2 Nutrition and recurring-meal learning

**Purpose:** Make nutrition tracking low-friction enough to sustain, then learn which meal/routine patterns support stated goals.

**Core rule:** A meal photograph is allowed to yield an **educated estimate** of calories and protein when recipe data are unavailable. This is an accepted product tradeoff. The output must show uncertainty—range or confidence, not fabricated exactness—and be used for trends, weekly averages, and pattern learning rather than a claim of nutritional ground truth.

For a photo of homemade dal, Ashwini may identify likely food components, estimate visible portion size from the known bowl/plate or a reference object, and estimate calories/protein from comparable dishes. It cannot see hidden oil, ghee, recipe proportions, servings from the pot, or food outside the image. Mixed dishes therefore carry lower confidence than clearly portioned/simple foods.

The system should become personally better over time without requiring full recipes for everything:

1. Suggest a likely meal identity and calorie/protein range from the image.
2. Ask for only the highest-value correction: usual recipe, extra oil/ghee, larger/smaller portion, a separate protein addition, or “not sure.”
3. Save recurring meals as private personal references when the user chooses to name them, e.g. `House Dal v1`.
4. Use later photos to recognize the reference meal and ask only when it materially differs.

**Possible outputs:**

- “This looks like a lower-confidence meal estimate; include it in the weekly trend, not today’s hard target.”
- “Your recurring afternoon pattern makes the protein floor difficult to reach. Choose a known fallback, or log today as an intentional miss.”
- “Pre-training meal routine is showing an early signal in comparable sessions; continue tracking.”

**Never:** present a photo estimate as precise fact, infer diagnosis from eating behavior, or issue prescriptive clinical diet advice.

### 7.3 Medication adherence and refill risk

**Purpose:** Maintain an accurate, useful adherence record without crossing into medical advice.

**Possible outputs:**

- Scheduled/actual adherence tracking
- Refill-risk reminder based on confirmed supply/fill information
- A data-quality block when a relevant adherence gap or dose change invalidates an experiment or verdict window

**Never:** check drug interactions, suggest dose/timing changes, evaluate prescription effectiveness, or treat a prescriber-controlled medication as an experiment variable.

Time-critical medication reminders must be delivered through a reliable native iOS mechanism, not depend solely on a Mac mini.

### 7.4 Body and aesthetic change

**Purpose:** Provide a trustworthy record of visible external change under standardized conditions, in the context of other trends.

**Capture cadence:** Weekly for body capture; slower protocol-based reviews for skin/hair. Daily capture is optional only as a temporary setup/calibration aid, never a daily body-score ritual.

**Protocol:** Same morning window, camera/lens, fixed height/distance, neutral lighting, background, minimal clothing, and relaxed front/side posture. For skin, add a consistent light setup and color reference card. Low-alignment or low-standardization captures are visibly marked and excluded from review.

**Interpretation:** Compare paired standardized images over meaningful intervals, then triangulate with smoothed weight, optional circumference measures, training progression, and adherence context.

**Allowed language:** “Across four standardized captures over 28 days, a visible silhouette change is consistent with your declared aesthetic goal. Weight and waist trends move in the same direction.”

**Never:** claim exact fat percentage, exact muscle gain/loss, internal health, a diagnosis, or that a body is objectively “better.” Any mole, lesion, or pigmented spot is excluded from analysis and routed to documentation plus dermatology.

### 7.5 Mood and focus

**Purpose:** Collect low-burden behavioral observations that may later be used as context, not psychological interpretation.

The product uses brief, randomized but user-respecting prompts with blackout windows. It treats burden and non-response as design feedback. Data remains blind during the planned collection period where that protects answer quality.

**Never:** infer psychological causes, diagnose, or issue late-night mental-health interpretations. Therapy material is not an inference source.

### 7.6 Training reference and movement library

**Purpose:** Keep the practical knowledge needed to understand and prepare for training in the private product, without recasting education as individualized medical or coaching advice.

The initial reference pack includes:

- A visual muscle-group atlas, including primary and supporting anatomical regions at an appropriate educational level.
- Movement-pattern explainers: squat, hinge, push, pull, carry, rotation, and locomotion.
- Exercise reference cards with the movement pattern, commonly involved muscle groups, equipment, setup, concise non-clinical cues, and general substitutions.
- Plain-language definitions for training terms such as set, repetition, effort, volume, progression, and deload.
- User-owned notes about equipment, prior sessions, or preferences, explicitly labeled as personal notes.

Reference cards must distinguish primary from supporting muscle groups, general education from a personal plan, and a user note from a verified fact. A card may state that a movement commonly involves a named muscle group; it must not diagnose pain, judge technique from text alone, prescribe rehabilitation, declare the movement safe for the user, or replace a coach, physical therapist, or clinician.

### 7.7 Contextual nutrition and medication references

Nutrition reference material may explain estimation uncertainty, common food-component terminology, and the user's opt-in recurring meal references. Medication reference material is restricted to user-entered prescription identity, schedule, adherence history, confirmed refill information, clinician/pharmacy handoff details, and the safety boundary. It does not provide drug-interaction, dose, timing, or effectiveness information.

## 8. Confound and evidence gate

Before any verdict or personal-comparison result, Ashwini checks the window for the relevant confounds:

- Sleep debt and recovery trend
- Travel, illness, alcohol, and unusual schedule changes
- More than one active intervention
- Incomplete source data
- Medication adherence below the relevant threshold
- Start, stop, dose change, or multi-day gap in a system-wide confounding medication class
- Capture quality for visual claims

The gate has three possible outputs:

1. **Clear:** the system may issue the appropriate evidence-labeled output.
2. **Caveated:** the system may show a low-confidence pattern but cannot recommend a conclusion or action beyond continued tracking.
3. **Blocked:** the system explains the missing/contaminating conditions and issues no verdict.

Thresholds are not assumed; they must be specified by domain and versioned before implementation. A user override, if ever allowed, must be explicit and permanently retained with the output it affected.

## 9. Decision object

Every interruption-worthy output is a durable record with:

- The decision or route-out type
- The evidence label and confidence explanation
- The data window, sources, and source-quality status
- Confounds checked and gate outcome
- The stated target and expected lag
- The action choices, including “do nothing” where appropriate
- An expiry/review time
- The user response
- The eventual outcome or reason it remained unresolved

This makes Ashwini accountable. It can later answer whether its suggestion was useful, ignored, impossible, or wrong.

## 10. Product surfaces and contextual learning layer

The intended PWA retains three surfaces:

1. **Capture:** Photo capture under a protocol, meal/photo capture, alignment feedback, and an offline queue.
2. **Today:** The current open decision, a required medication/adherence action, and any unanswered short prompt. It is usually nearly empty.
3. **Review:** Weekly and protocol-based evidence-labeled summaries, paired capture comparison, current learning routines, and decisions/outcomes.

The **Learning layer** is accessible contextually from all three surfaces and directly through an intentional library entry point. It holds reference assets, provenance, review status, and personal notes. It is not a notification surface and does not generate personal conclusions on its own.

Graph browsing and rich historical exploration belong in rendered private notes/Obsidian, not the PWA’s primary surface.

## 11. Safety and privacy boundaries

1. Nothing diagnoses, prescribes, or replaces clinical care.
2. Photos remain private except for the minimum specific paired images required for an explicitly authorized analysis.
3. No public ingress; the private-network architecture is mandatory.
4. Moles, lesions, and pigmented spots are never analyzed.
5. No verdict is issued for a blocked/confounded window.
6. Prescription medication is never an experimental variable.
7. No drug-interaction, dose, medication-timing, or medication-effectiveness advice.
8. Critical dose reminders do not rely solely on the Mac mini.
9. Therapy content is inert and excluded from inference; do not add therapy-transcript storage to the initial scope.
10. Every model-generated output must carry its evidence status and data provenance.
11. Reference assets must show their source/provenance, version, review status, and educational boundary; a reference asset is not personalized advice.

## 12. Discovery questions before implementation

The product direction is set; these questions require validation rather than assumption:

1. Which two or three micro-tests are genuinely useful enough to sustain for 30 days?
2. What photo-confirmation interaction produces a usable nutrition trend with minimal logging burden?
3. Which recurring household meals benefit most from personal reference calibration, and what correction prompts are actually tolerable?
4. What capture protocol can be repeated weekly without body-checking or photo fatigue?
5. Which source integrations are technically reliable enough to become canonical records, including backfill, deduplication, and authentication?
6. What confound thresholds produce trustworthy silence without making all verdicts unavailable?
7. What privacy/retention model is acceptable before any health or photo data is stored?
8. Which initial movement, muscle, and training-reference assets are useful enough to retain offline, and what editorial source/review standard is sufficient for each?
9. Which reference explanations reduce friction at the point of action without turning ashwini into a generic health-content feed?

## 13. Build sequencing after discovery

Implementation begins only after the discovery questions above are answered. The likely sequence is:

1. **Private data foundation:** Canonical storage, provenance, private network, backup/retention controls, and reliable ingest verification.
2. **Reference foundation:** A versioned, offline-capable starter library for movement patterns, muscle groups, training vocabulary, evidence labels, and user-owned notes. No personal health inference is required to ship this layer.
3. **Baseline stabilization:** Medication-adherence logging plus one sustainable diet anchor while training has not yet restarted. The two routines are displayed together but stored and interpreted separately.
4. **One trustworthy loop:** After actual training restart, add training plus photo-assisted nutrition capture, a confound gate, and exactly one weekly evidence-labeled review.
5. **Micro-test support:** Declare a routine, record comparable occurrences, display uncertainty, and log outcomes.
6. **Visual protocol:** Capture-quality enforcement, paired review, and body/skin visual-delta language only.
7. **Additional domains:** ESM, labs, hair, and graph rendering only when their safety and evidence conditions are satisfied.

No graph mining, broad model inference, therapy layer, or automated clinical interpretation belongs in the initial implementation.

## 14. Success criteria

Ashwini is working when, after a meaningful period of use, the user can point to:

- A small set of repeatable routines with a clear target and evidence status
- At least one decision they changed because Ashwini made the conditions legible
- At least one tempting conclusion Ashwini correctly refused to make
- Nutrition history that is useful for trends despite incomplete recipe information
- Standardized visual comparisons that feel grounded rather than compulsive
- A private record that is more useful in a clinician, coach, or therapy conversation without pretending to replace any of them
- The practical reference material needed to understand a routine or movement without leaving the private product, while still knowing exactly what is general education versus personal evidence
