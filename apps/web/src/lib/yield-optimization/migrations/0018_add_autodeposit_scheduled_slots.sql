DO $$
BEGIN
    CREATE TYPE loyal_yield.balance_sweep_scheduled_slot_status AS ENUM (
        'scheduled',
        'requested',
        'selected',
        'executed',
        'failed',
        'released',
        'canceled'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS loyal_yield.balance_sweep_scheduled_slots (
    id BIGSERIAL PRIMARY KEY,
    target_id BIGINT NOT NULL REFERENCES loyal_yield.balance_sweep_targets(id) ON DELETE CASCADE,
    token_mint TEXT NOT NULL,
    eligible_after TIMESTAMPTZ NOT NULL,
    status loyal_yield.balance_sweep_scheduled_slot_status NOT NULL DEFAULT 'scheduled',
    request_source TEXT,
    requested_at TIMESTAMPTZ,
    claim_token TEXT REFERENCES loyal_yield.balance_sweep_lot_claims(claim_token) ON DELETE SET NULL,
    execution_id BIGINT REFERENCES loyal_yield.balance_sweep_executions(id) ON DELETE SET NULL,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS balance_sweep_scheduled_slots_target_status_idx
    ON loyal_yield.balance_sweep_scheduled_slots (target_id, token_mint, status, eligible_after, id);
CREATE INDEX IF NOT EXISTS balance_sweep_scheduled_slots_claim_token_idx
    ON loyal_yield.balance_sweep_scheduled_slots (claim_token)
    WHERE claim_token IS NOT NULL;

ALTER TABLE loyal_yield.balance_sweep_surplus_lots
    ADD COLUMN IF NOT EXISTS scheduled_slot_id BIGINT
        REFERENCES loyal_yield.balance_sweep_scheduled_slots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS balance_sweep_surplus_lots_scheduled_slot_idx
    ON loyal_yield.balance_sweep_surplus_lots (scheduled_slot_id, status, eligible_after, id)
    WHERE scheduled_slot_id IS NOT NULL;

WITH open_lot_groups AS (
    SELECT
        lot.target_id,
        event.mint AS token_mint,
        MAX(lot.eligible_after) AS eligible_after,
        MIN(lot.created_at) AS created_at,
        MAX(lot.updated_at) AS updated_at
    FROM loyal_yield.balance_sweep_surplus_lots AS lot
    JOIN loyal_yield.balance_sweep_wallet_balance_events AS event
      ON event.event_id = lot.source_event_id
    WHERE lot.status = 'open'
      AND lot.remaining_amount_raw > 0
      AND lot.scheduled_slot_id IS NULL
    GROUP BY lot.target_id, event.mint
),
inserted_slots AS (
    INSERT INTO loyal_yield.balance_sweep_scheduled_slots (
        target_id,
        token_mint,
        eligible_after,
        status,
        created_at,
        updated_at
    )
    SELECT
        target_id,
        token_mint,
        eligible_after,
        'scheduled',
        created_at,
        updated_at
    FROM open_lot_groups
    RETURNING id, target_id, token_mint
)
UPDATE loyal_yield.balance_sweep_surplus_lots AS lot
SET scheduled_slot_id = inserted_slots.id,
    updated_at = now()
FROM inserted_slots
JOIN loyal_yield.balance_sweep_wallet_balance_events AS event
  ON event.target_id = inserted_slots.target_id
 AND event.mint = inserted_slots.token_mint
WHERE lot.source_event_id = event.event_id
  AND lot.target_id = inserted_slots.target_id
  AND lot.status = 'open'
  AND lot.remaining_amount_raw > 0
  AND lot.scheduled_slot_id IS NULL;

DROP VIEW IF EXISTS loyal_yield.pending_balance_sweep_surplus_lots;

CREATE VIEW loyal_yield.pending_balance_sweep_surplus_lots AS
SELECT
    lot.id,
    lot.target_id,
    lot.scheduled_slot_id,
    lot.source_event_id,
    lot.source_signature,
    lot.classification::text AS classification,
    lot.original_amount_raw,
    lot.remaining_amount_raw,
    lot.eligible_after,
    lot.status::text AS status,
    lot.confidence,
    lot.reason,
    lot.created_at,
    lot.updated_at,
    event.mint AS source_mint,
    event.wallet_token_ata AS source_wallet_token_ata
FROM loyal_yield.balance_sweep_surplus_lots AS lot
JOIN loyal_yield.balance_sweep_wallet_balance_events AS event
  ON event.event_id = lot.source_event_id
WHERE lot.status = 'open'
  AND lot.remaining_amount_raw > 0;
