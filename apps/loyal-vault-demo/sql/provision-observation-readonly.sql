-- Least-privilege observation access for apps/loyal-vault-demo.
--
-- Purpose: the demo frontend reads only the current HXtk/ST999 pilot servicing
-- projection (deposit release gate, worker observation, consumed-report
-- locator). This file creates three route-pinned, column-filtered views and a
-- single LOGIN role that can read ONLY those views. It grants no base-table,
-- write, schema-creation or role-administration privileges.
--
-- Apply as the database owner (neondb_owner), once per environment. Idempotent:
-- safe to re-run (CREATE OR REPLACE keeps the column list stable; column
-- changes need an explicit DROP VIEW first, which is a reviewed change).
--
-- NO password literals here. The coordinator generates the secret out of band
-- and installs it without storing it in this repository:
--   ALTER ROLE loyal_vault_demo_observation PASSWORD '<generated-secret>';
-- (or via the Neon console), then wires it into the hosting-only server
-- variable LOYAL_VAULT_DEMO_OBSERVATION_DATABASE_URL. Never commit or log it.
--
-- Exposure summary (everything else in loyal_yield is invisible to the role):
--   pilot_route_observation : lease columns, ten admitted servicing
--                             observation fields (rebuilt; never the raw
--                             state/observation JSON), pilot-activation and
--                             manual-hold booleans. lease_owner stays
--                             server-side for the release comparison and is
--                             never returned to browsers.
--   pilot_operations        : journal metadata leaves for the pinned route
--                             (action/status/engine/config/slot/signature/
--                             timestamps). No signed wire, expected_effects or
--                             full state.
--   pilot_report_locators   : reconciled REPORT_NAV locators only — signature,
--                             message_sha256, confirmed_slot (operation_id and
--                             updated_at are ordering keys only, not consumed
--                             evidence). Finalized-RPC wire/trace verification
--                             stays in the app.
--
-- Never grant this role SELECT on the underlying tables, on any other route,
-- or any INSERT/UPDATE/DELETE/DDL privilege.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'loyal_vault_demo_observation') THEN
    CREATE ROLE loyal_vault_demo_observation
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

-- Pinned pilot route: manager ST999VUTo5QExYEX9bz1oDDoKGkjXG9zpphy4Hj7VWh
-- (public identities also pinned in src/features/vault/domain/identity.ts).

-- Route-state servicing projection for the deposit gate and /api/worker.
CREATE OR REPLACE VIEW loyal_yield.pilot_route_observation
  WITH (security_barrier = true) AS
SELECT
  r.route_key,
  r.lease_owner,
  r.lease_expires_at,
  jsonb_build_object(
    'observedAt',             r.state->'observation'->'observedAt',
    'observedSlot',           r.state->'observation'->'observedSlot',
    'navFresh',               r.state->'observation'->'navFresh',
    'routeStatus',            r.state->'observation'->'routeStatus',
    'aumRaw',                 r.state->'observation'->'aumRaw',
    'voltrIdleRaw',           r.state->'observation'->'voltrIdleRaw',
    'squadsIdleRaw',          r.state->'observation'->'squadsIdleRaw',
    'computedStrategyNavRaw', r.state->'observation'->'computedStrategyNavRaw',
    'reportedNavRaw',         r.state->'observation'->'reportedNavRaw',
    'voltrStrategyIdleRaw',   r.state->'observation'->'voltrStrategyIdleRaw'
  ) AS observation,
  ((r.state->'phase3'->>'closed'='false'
    AND r.state->'phase3'->'pilot'->>'schema'='voltr-rwa-pilot-budget/v1'
    AND r.state->'phase3'->'pilot'->>'authorityId'='01a0a776-cb66-7333-99eb-7e6927c1e114'
    AND r.state->'pilotBudgetActivation'->'authority'=r.state->'phase3'->'pilot') IS TRUE) AS pilot_active,
  NOT EXISTS(SELECT 1 FROM loyal_yield.backyard_manual_recovery_latches l
    WHERE l.route_key=r.route_key AND l.cleared_at IS NULL) AS no_manual_hold
FROM loyal_yield.multiply_route_states r
WHERE r.route_key='rwa-multiply:ST999VUTo5QExYEX9bz1oDDoKGkjXG9zpphy4Hj7VWh';

-- Journal metadata leaves for the pinned route. The journal strategy config is
-- exposed as a leaf so readers never receive expected_effects JSON.
CREATE OR REPLACE VIEW loyal_yield.pilot_operations
  WITH (security_barrier = true) AS
SELECT
  o.route_key,
  o.operation_id,
  o.action,
  o.status,
  o.engine_version,
  o.expected_effects->>'journalStrategyConfig' AS journal_strategy_config,
  o.transaction_signature,
  o.confirmed_slot,
  o.updated_at
FROM loyal_yield.multiply_operations o
WHERE o.route_key='rwa-multiply:ST999VUTo5QExYEX9bz1oDDoKGkjXG9zpphy4Hj7VWh';

-- Consumed-report locators: reconciled REPORT_NAV operations whose journal
-- matches the current adaptor configuration strategy. operation_id/updated_at
-- exist for deterministic latest-row ordering; they are not consumed evidence.
CREATE OR REPLACE VIEW loyal_yield.pilot_report_locators
  WITH (security_barrier = true) AS
SELECT
  o.transaction_signature,
  o.message_sha256,
  o.confirmed_slot,
  o.operation_id,
  o.updated_at
FROM loyal_yield.multiply_operations o
WHERE o.route_key='rwa-multiply:ST999VUTo5QExYEX9bz1oDDoKGkjXG9zpphy4Hj7VWh'
  AND o.engine_version='backyard_rwa_v1'
  AND o.action='REPORT_NAV'
  AND o.status='reconciled'
  AND o.expected_effects->>'journalStrategyConfig'='DCpR24Eb6xCWxDyaZvCBTkadkxCB2vkqJN1EfYNWtLxY';

-- The role keeps zero base-table privileges; views run with the applying
-- owner's rights. Revoke first so a re-run cannot preserve stale grants.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA loyal_yield FROM loyal_vault_demo_observation;
GRANT USAGE ON SCHEMA loyal_yield TO loyal_vault_demo_observation;
GRANT SELECT ON loyal_yield.pilot_route_observation,
                loyal_yield.pilot_operations,
                loyal_yield.pilot_report_locators
  TO loyal_vault_demo_observation;

-- Belt-and-braces role scope: reads only, and every statement bounded.
ALTER ROLE loyal_vault_demo_observation SET default_transaction_read_only = on;
ALTER ROLE loyal_vault_demo_observation SET statement_timeout = '5s';

COMMIT;

-- Rollback (as owner), only after the demo no longer points at this database:
-- REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA loyal_yield FROM loyal_vault_demo_observation;
-- REVOKE USAGE ON SCHEMA loyal_yield FROM loyal_vault_demo_observation;
-- DROP VIEW IF EXISTS loyal_yield.pilot_report_locators;
-- DROP VIEW IF EXISTS loyal_yield.pilot_operations;
-- DROP VIEW IF EXISTS loyal_yield.pilot_route_observation;
-- DROP ROLE loyal_vault_demo_observation;
