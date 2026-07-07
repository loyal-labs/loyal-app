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

    SELECT slot.id
    INTO scheduled_slot_id
    FROM loyal_yield.balance_sweep_scheduled_slots AS slot
    LEFT JOIN loyal_yield.balance_sweep_lot_claims AS claim
      ON claim.claim_token = slot.claim_token
    WHERE slot.execution_id = NEW.id
       OR (
          slot.target_id = NEW.target_id
          AND slot.status = 'selected'
          AND claim.status = 'selected'
          AND claim.execution_id IS NULL
       )
    ORDER BY
        CASE WHEN slot.execution_id = NEW.id THEN 0 ELSE 1 END,
        slot.updated_at DESC,
        slot.id DESC
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
