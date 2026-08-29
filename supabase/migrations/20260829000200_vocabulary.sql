-- The PRD's own vocabulary, as database types.
--
-- Kept deliberately separate from ashwini.edge_status: that describes a
-- relationship in a knowledge graph, this describes what Ashwini is allowed to
-- say about one output right now. Conflating them is the trap the comment on
-- ashwini.edges warns about.

-- PRD 4.5. The nine statuses, in the order the PRD table lists them.
-- domain/evidence.ts holds the same list and a test pins the two together.
create type ashwini.evidence_status as enum (
  'recorded',
  'unusable',
  'rule_based',
  'noticed',
  'tracking',
  'early_signal',
  'consistent_pattern',
  'personally_useful',
  'route_out'
);

-- PRD 8. Exactly three outcomes.
create type ashwini.gate_outcome as enum ('clear', 'caveated', 'blocked');

-- PRD 7 learning domains, plus `system` for outputs belonging to no one domain.
create type ashwini.domain as enum (
  'training', 'nutrition', 'medication', 'body', 'focus', 'system'
);

-- PRD 9 decision types.
create type ashwini.decision_type as enum (
  'recommendation', 'data_quality_block', 'scheduled_review', 'route_out'
);

-- Where a route-out sends the user. PRD 4.4, 11.4, 11.7.
create type ashwini.route_destination as enum (
  'emergency', 'crisis_line', 'clinician', 'pharmacist', 'prescriber', 'dermatologist'
);

create type ashwini.message_role as enum ('user', 'ashwini');
create type ashwini.message_kind as enum ('record', 'recommendation', 'question', 'route');
create type ashwini.confound_state as enum ('absent', 'present', 'unknown');
create type ashwini.meal_kind as enum ('breakfast', 'lunch', 'dinner', 'snack');
create type ashwini.estimate_confidence as enum ('low', 'medium', 'high');
create type ashwini.routine_status as enum ('candidate', 'active', 'paused', 'concluded', 'retired');
create type ashwini.source_state as enum ('available', 'needs_review', 'protected', 'excluded');
