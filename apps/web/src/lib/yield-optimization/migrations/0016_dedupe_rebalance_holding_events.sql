WITH ranked_rebalance_events AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY source_rebalance_decision_id
      ORDER BY observed_slot DESC, observed_at DESC, id DESC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY source_rebalance_decision_id
      ORDER BY observed_slot DESC, observed_at DESC, id DESC
    ) AS row_number
  FROM loyal_yield.user_yield_position_holding_events
  WHERE source_rebalance_decision_id IS NOT NULL
),
duplicate_rebalance_events AS (
  SELECT id, keep_id
  FROM ranked_rebalance_events
  WHERE row_number > 1
),
repointed_positions AS (
  UPDATE loyal_yield.user_yield_positions position
  SET last_holding_event_id = duplicate.keep_id
  FROM duplicate_rebalance_events duplicate
  WHERE position.last_holding_event_id = duplicate.id
  RETURNING position.id
)
DELETE FROM loyal_yield.user_yield_position_holding_events event
USING duplicate_rebalance_events duplicate
WHERE event.id = duplicate.id;

CREATE UNIQUE INDEX IF NOT EXISTS user_yield_position_holding_events_rebalance_decision_uidx
  ON loyal_yield.user_yield_position_holding_events (source_rebalance_decision_id)
  WHERE source_rebalance_decision_id IS NOT NULL;
