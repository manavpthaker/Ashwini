-- A decision response is an immutable answer, not an event stream. The route
-- also serializes on the decision row, but the database must keep the invariant
-- for every future writer, script, and integration.

drop index if exists ashwini.decision_responses_decision_idx;
create unique index decision_responses_one_per_decision_idx
  on ashwini.decision_responses (decision_id);
