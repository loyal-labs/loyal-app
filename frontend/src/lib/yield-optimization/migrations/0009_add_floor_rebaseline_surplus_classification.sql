ALTER TYPE loyal_yield.balance_sweep_surplus_classification
  ADD VALUE IF NOT EXISTS 'floor_rebaseline';

CREATE SEQUENCE IF NOT EXISTS loyal_yield.balance_sweep_floor_rebaseline_event_id_seq
  AS BIGINT
  INCREMENT BY -1
  MINVALUE -9223372036854775808
  MAXVALUE -1000000000000
  START WITH -1000000000000
  CACHE 1;
