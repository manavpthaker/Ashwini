-- A model's provisional synthesis is neither a fixed rule nor a measured pattern.
alter type ashwini.evidence_status add value if not exists 'working_hypothesis';
