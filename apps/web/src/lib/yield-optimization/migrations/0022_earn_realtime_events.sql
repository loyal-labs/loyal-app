CREATE INDEX IF NOT EXISTS realtime_events_smart_account_address_id_idx
    ON loyal_yield.realtime_events (smart_account_address, id)
    WHERE smart_account_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS realtime_events_event_type_id_idx
    ON loyal_yield.realtime_events (event_type, id);

CREATE OR REPLACE FUNCTION loyal_yield.realtime_private_scope_requires_identity(
    p_scope TEXT,
    p_event_type TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT COALESCE(p_scope, '') IN ('autodeposit', 'earn', 'onboarding')
        OR COALESCE(p_event_type, '') LIKE 'earn.%'
$$;

CREATE OR REPLACE FUNCTION loyal_yield.realtime_relation_has_columns(
    p_relation REGCLASS,
    VARIADIC p_columns TEXT[]
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT NOT EXISTS (
        SELECT 1
        FROM unnest(p_columns) AS required_column(column_name)
        WHERE NOT EXISTS (
            SELECT 1
            FROM pg_attribute
            WHERE attrelid = p_relation
              AND attname = required_column.column_name
              AND NOT attisdropped
        )
    )
$$;

CREATE OR REPLACE FUNCTION loyal_yield.emit_realtime_event(
    p_event_type TEXT,
    p_scope TEXT,
    p_reason TEXT,
    p_solana_env TEXT DEFAULT NULL,
    p_wallet_address TEXT DEFAULT NULL,
    p_settings_pda TEXT DEFAULT NULL,
    p_smart_account_address TEXT DEFAULT NULL,
    p_vault_pubkey TEXT DEFAULT NULL,
    p_target_id BIGINT DEFAULT NULL,
    p_scheduled_slot_id BIGINT DEFAULT NULL,
    p_execution_id BIGINT DEFAULT NULL,
    p_source_table TEXT DEFAULT NULL,
    p_source_id TEXT DEFAULT NULL,
    p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    inserted_event_id BIGINT;
BEGIN
    IF loyal_yield.realtime_private_scope_requires_identity(p_scope, p_event_type)
       AND p_wallet_address IS NULL
       AND p_settings_pda IS NULL
       AND p_smart_account_address IS NULL THEN
        RAISE EXCEPTION
            'private realtime event %.% requires wallet_address, settings_pda, or smart_account_address',
            p_scope,
            p_event_type
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO loyal_yield.realtime_events (
        event_type,
        scope,
        reason,
        solana_env,
        wallet_address,
        settings_pda,
        smart_account_address,
        vault_pubkey,
        target_id,
        scheduled_slot_id,
        execution_id,
        source_table,
        source_id,
        payload
    )
    VALUES (
        p_event_type,
        p_scope,
        p_reason,
        p_solana_env,
        p_wallet_address,
        p_settings_pda,
        p_smart_account_address,
        p_vault_pubkey,
        p_target_id,
        p_scheduled_slot_id,
        p_execution_id,
        p_source_table,
        p_source_id,
        COALESCE(p_payload, '{}'::jsonb)
    )
    RETURNING id INTO inserted_event_id;

    PERFORM pg_notify(
        'loyal_yield_realtime',
        json_build_object('event_id', inserted_event_id)::text
    );

    RETURN inserted_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION loyal_yield.emit_autodeposit_scheduled_slot_realtime_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_row RECORD;
    event_reason TEXT;
    event_payload JSONB;
    canonical_event_type TEXT;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
       AND NEW.token_mint IS NOT DISTINCT FROM OLD.token_mint
       AND NEW.eligible_after IS NOT DISTINCT FROM OLD.eligible_after
       AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.request_source IS NOT DISTINCT FROM OLD.request_source
       AND NEW.requested_at IS NOT DISTINCT FROM OLD.requested_at
       AND NEW.claim_token IS NOT DISTINCT FROM OLD.claim_token
       AND NEW.execution_id IS NOT DISTINCT FROM OLD.execution_id
       AND NEW.last_error IS NOT DISTINCT FROM OLD.last_error THEN
        RETURN NEW;
    END IF;

    SELECT
        settings,
        wallet,
        vault_pubkey
    INTO target_row
    FROM loyal_yield.balance_sweep_targets
    WHERE id = NEW.target_id;

    event_reason := 'scheduled_slot_' || NEW.status::text;
    event_payload := jsonb_strip_nulls(jsonb_build_object(
        'status', NEW.status::text,
        'previousStatus', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status::text ELSE NULL END,
        'requestSource', NEW.request_source,
        'requestedAt', NEW.requested_at,
        'eligibleAfter', NEW.eligible_after,
        'tokenMint', NEW.token_mint,
        'hasClaimToken', NEW.claim_token IS NOT NULL,
        'hasExecution', NEW.execution_id IS NOT NULL,
        'hasError', NEW.last_error IS NOT NULL
    ));

    PERFORM loyal_yield.emit_realtime_event(
        p_event_type => 'autodeposit_slot_changed',
        p_scope => 'autodeposit',
        p_reason => event_reason,
        p_wallet_address => target_row.wallet,
        p_settings_pda => target_row.settings,
        p_vault_pubkey => target_row.vault_pubkey,
        p_target_id => NEW.target_id,
        p_scheduled_slot_id => NEW.id,
        p_execution_id => NEW.execution_id,
        p_source_table => 'balance_sweep_scheduled_slots',
        p_source_id => NEW.id::text,
        p_payload => event_payload
    );

    canonical_event_type := CASE NEW.status::text
        WHEN 'requested' THEN 'earn.autodeposit.sweep_requested'
        WHEN 'selected' THEN 'earn.autodeposit.sweep_selected'
        ELSE NULL
    END;

    IF canonical_event_type IS NOT NULL THEN
        PERFORM loyal_yield.emit_realtime_event(
            p_event_type => canonical_event_type,
            p_scope => 'autodeposit',
            p_reason => event_reason,
            p_wallet_address => target_row.wallet,
            p_settings_pda => target_row.settings,
            p_smart_account_address => target_row.vault_pubkey,
            p_vault_pubkey => target_row.vault_pubkey,
            p_target_id => NEW.target_id,
            p_scheduled_slot_id => NEW.id,
            p_execution_id => NEW.execution_id,
            p_source_table => 'balance_sweep_scheduled_slots',
            p_source_id => NEW.id::text,
            p_payload => event_payload
        );
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION loyal_yield.emit_autodeposit_execution_realtime_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_row RECORD;
    scheduled_slot_id BIGINT;
    event_payload JSONB;
BEGIN
    SELECT
        settings,
        wallet,
        vault_pubkey
    INTO target_row
    FROM loyal_yield.balance_sweep_targets
    WHERE id = NEW.target_id;

    SELECT id
    INTO scheduled_slot_id
    FROM loyal_yield.balance_sweep_scheduled_slots
    WHERE execution_id = NEW.id
    ORDER BY updated_at DESC, id DESC
    LIMIT 1;

    event_payload := jsonb_strip_nulls(jsonb_build_object(
        'signature', NEW.signature,
        'slot', NEW.slot,
        'tokenMint', NEW.token_mint,
        'scheduledSlotId', scheduled_slot_id
    ));

    PERFORM loyal_yield.emit_realtime_event(
        p_event_type => 'earn.autodeposit.sweep_executed',
        p_scope => 'autodeposit',
        p_reason => 'scheduled_slot_executed',
        p_wallet_address => target_row.wallet,
        p_settings_pda => target_row.settings,
        p_smart_account_address => target_row.vault_pubkey,
        p_vault_pubkey => target_row.vault_pubkey,
        p_target_id => NEW.target_id,
        p_scheduled_slot_id => scheduled_slot_id,
        p_execution_id => NEW.id,
        p_source_table => 'balance_sweep_executions',
        p_source_id => NEW.id::text,
        p_payload => event_payload
    );

    PERFORM loyal_yield.emit_realtime_event(
        p_event_type => 'earn.transaction.recorded',
        p_scope => 'earn',
        p_reason => 'autodeposit_executed',
        p_wallet_address => target_row.wallet,
        p_settings_pda => target_row.settings,
        p_smart_account_address => target_row.vault_pubkey,
        p_vault_pubkey => target_row.vault_pubkey,
        p_target_id => NEW.target_id,
        p_scheduled_slot_id => scheduled_slot_id,
        p_execution_id => NEW.id,
        p_source_table => 'balance_sweep_executions',
        p_source_id => NEW.id::text,
        p_payload => event_payload
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS balance_sweep_executions_realtime_event
    ON loyal_yield.balance_sweep_executions;

CREATE TRIGGER balance_sweep_executions_realtime_event
AFTER INSERT ON loyal_yield.balance_sweep_executions
FOR EACH ROW
EXECUTE FUNCTION loyal_yield.emit_autodeposit_execution_realtime_event();

CREATE OR REPLACE FUNCTION loyal_yield.emit_user_yield_position_realtime_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    event_reason TEXT;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.wallet_address IS NOT DISTINCT FROM OLD.wallet_address
       AND NEW.smart_account_address IS NOT DISTINCT FROM OLD.smart_account_address
       AND NEW.settings IS NOT DISTINCT FROM OLD.settings
       AND NEW.vault_pubkey IS NOT DISTINCT FROM OLD.vault_pubkey
       AND NEW.principal_amount_raw IS NOT DISTINCT FROM OLD.principal_amount_raw
       AND NEW.current_reserve IS NOT DISTINCT FROM OLD.current_reserve
       AND NEW.current_liquidity_mint IS NOT DISTINCT FROM OLD.current_liquidity_mint
       AND NEW.current_amount_raw IS NOT DISTINCT FROM OLD.current_amount_raw
       AND NEW.last_holding_event_id IS NOT DISTINCT FROM OLD.last_holding_event_id
       AND NEW.last_rebalance_decision_id IS NOT DISTINCT FROM OLD.last_rebalance_decision_id
       AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    event_reason := CASE TG_OP
        WHEN 'INSERT' THEN 'position_created'
        ELSE 'position_updated'
    END;

    PERFORM loyal_yield.emit_realtime_event(
        p_event_type => 'earn.position.changed',
        p_scope => 'earn',
        p_reason => event_reason,
        p_wallet_address => NEW.wallet_address,
        p_settings_pda => NEW.settings,
        p_smart_account_address => NEW.smart_account_address,
        p_vault_pubkey => NEW.vault_pubkey,
        p_source_table => 'user_yield_positions',
        p_source_id => NEW.id::text,
        p_payload => jsonb_strip_nulls(jsonb_build_object(
            'status', NEW.status::text,
            'vaultIndex', NEW.vault_index,
            'currentReserve', NEW.current_reserve,
            'currentLiquidityMint', NEW.current_liquidity_mint,
            'lastHoldingEventId', NEW.last_holding_event_id,
            'lastRebalanceDecisionId', NEW.last_rebalance_decision_id
        ))
    );

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION loyal_yield.emit_user_yield_holding_event_realtime_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    position_row RECORD;
BEGIN
    SELECT
        wallet_address,
        settings,
        smart_account_address,
        vault_pubkey
    INTO position_row
    FROM loyal_yield.user_yield_positions
    WHERE id = NEW.position_id;

    PERFORM loyal_yield.emit_realtime_event(
        p_event_type => 'earn.transaction.recorded',
        p_scope => 'earn',
        p_reason => 'holding_event_' || NEW.event_type::text,
        p_wallet_address => position_row.wallet_address,
        p_settings_pda => position_row.settings,
        p_smart_account_address => position_row.smart_account_address,
        p_vault_pubkey => position_row.vault_pubkey,
        p_source_table => 'user_yield_position_holding_events',
        p_source_id => NEW.id::text,
        p_payload => jsonb_strip_nulls(jsonb_build_object(
            'positionId', NEW.position_id,
            'eventType', NEW.event_type::text,
            'reserve', NEW.reserve,
            'liquidityMint', NEW.liquidity_mint,
            'sourceSignature', NEW.source_signature,
            'sourceDepositId', NEW.source_deposit_id,
            'sourceWithdrawalId', NEW.source_withdrawal_id,
            'sourceRebalanceDecisionId', NEW.source_rebalance_decision_id,
            'sourceSnapshotId', NEW.source_snapshot_id
        ))
    );

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION loyal_yield.emit_earn_onboarding_realtime_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    event_reason TEXT;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.smart_account_address IS NOT DISTINCT FROM OLD.smart_account_address
       AND NEW.route_policy_signature IS NOT DISTINCT FROM OLD.route_policy_signature
       AND NEW.setup_policy_signature IS NOT DISTINCT FROM OLD.setup_policy_signature
       AND NEW.deposit_signature IS NOT DISTINCT FROM OLD.deposit_signature
       AND NEW.deposit_confirmed_slot IS NOT DISTINCT FROM OLD.deposit_confirmed_slot
       AND NEW.principal_amount_raw IS NOT DISTINCT FROM OLD.principal_amount_raw
       AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.last_error_code IS NOT DISTINCT FROM OLD.last_error_code THEN
        RETURN NEW;
    END IF;

    event_reason := CASE
        WHEN TG_OP = 'INSERT' THEN 'onboarding_started'
        WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'onboarding_status_changed'
        WHEN NEW.last_error_code IS DISTINCT FROM OLD.last_error_code THEN 'onboarding_error_changed'
        ELSE 'onboarding_updated'
    END;

    PERFORM loyal_yield.emit_realtime_event(
        p_event_type => 'earn.onboarding.changed',
        p_scope => 'earn',
        p_reason => event_reason,
        p_wallet_address => NEW.wallet_address,
        p_settings_pda => NEW.settings,
        p_smart_account_address => NEW.smart_account_address,
        p_vault_pubkey => NEW.vault_pubkey,
        p_source_table => 'earn_deposit_onboarding_attempts',
        p_source_id => NEW.id::text,
        p_payload => jsonb_strip_nulls(jsonb_build_object(
            'status', NEW.status,
            'vaultIndex', NEW.vault_index,
            'hasRoutePolicySignature', NEW.route_policy_signature IS NOT NULL,
            'hasSetupPolicySignature', NEW.setup_policy_signature IS NOT NULL,
            'hasDepositSignature', NEW.deposit_signature IS NOT NULL,
            'lastErrorCode', NEW.last_error_code
        ))
    );

    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF to_regclass('loyal_yield.user_yield_positions') IS NOT NULL
       AND loyal_yield.realtime_relation_has_columns(
            'loyal_yield.user_yield_positions'::regclass,
            VARIADIC ARRAY[
                'id',
                'wallet_address',
                'smart_account_address',
                'settings',
                'vault_index',
                'vault_pubkey',
                'principal_amount_raw',
                'current_reserve',
                'current_liquidity_mint',
                'current_amount_raw',
                'last_holding_event_id',
                'last_rebalance_decision_id',
                'status'
            ]
       ) THEN
        EXECUTE 'DROP TRIGGER IF EXISTS user_yield_positions_realtime_event ON loyal_yield.user_yield_positions';
        EXECUTE 'CREATE TRIGGER user_yield_positions_realtime_event
                 AFTER INSERT OR UPDATE ON loyal_yield.user_yield_positions
                 FOR EACH ROW
                 EXECUTE FUNCTION loyal_yield.emit_user_yield_position_realtime_event()';
    END IF;

    IF to_regclass('loyal_yield.user_yield_position_holding_events') IS NOT NULL
       AND to_regclass('loyal_yield.user_yield_positions') IS NOT NULL
       AND loyal_yield.realtime_relation_has_columns(
            'loyal_yield.user_yield_position_holding_events'::regclass,
            VARIADIC ARRAY[
                'id',
                'position_id',
                'event_type',
                'reserve',
                'liquidity_mint',
                'source_signature',
                'source_deposit_id',
                'source_withdrawal_id',
                'source_rebalance_decision_id',
                'source_snapshot_id'
            ]
       ) THEN
        EXECUTE 'DROP TRIGGER IF EXISTS user_yield_position_holding_events_realtime_event ON loyal_yield.user_yield_position_holding_events';
        EXECUTE 'CREATE TRIGGER user_yield_position_holding_events_realtime_event
                 AFTER INSERT ON loyal_yield.user_yield_position_holding_events
                 FOR EACH ROW
                 EXECUTE FUNCTION loyal_yield.emit_user_yield_holding_event_realtime_event()';
    END IF;

    IF to_regclass('loyal_yield.earn_deposit_onboarding_attempts') IS NOT NULL
       AND loyal_yield.realtime_relation_has_columns(
            'loyal_yield.earn_deposit_onboarding_attempts'::regclass,
            VARIADIC ARRAY[
                'id',
                'wallet_address',
                'smart_account_address',
                'settings',
                'vault_index',
                'vault_pubkey',
                'route_policy_signature',
                'setup_policy_signature',
                'deposit_signature',
                'deposit_confirmed_slot',
                'principal_amount_raw',
                'status',
                'last_error_code'
            ]
       ) THEN
        EXECUTE 'DROP TRIGGER IF EXISTS earn_deposit_onboarding_attempts_realtime_event ON loyal_yield.earn_deposit_onboarding_attempts';
        EXECUTE 'CREATE TRIGGER earn_deposit_onboarding_attempts_realtime_event
                 AFTER INSERT OR UPDATE ON loyal_yield.earn_deposit_onboarding_attempts
                 FOR EACH ROW
                 EXECUTE FUNCTION loyal_yield.emit_earn_onboarding_realtime_event()';
    END IF;
END $$;
