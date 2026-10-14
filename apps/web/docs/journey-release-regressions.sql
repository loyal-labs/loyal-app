-- Rolling six-hour first-attempt technical failures/stalls, evaluated hourly.
-- A journey needs its attempt-1 entry and ten minutes of observation.
WITH journeys AS (
  SELECT
    LogAttributes['loyal.flow.name'] AS flow,
    LogAttributes['loyal.journey.id'] AS journey,
    argMinIf(LogAttributes['loyal.client.build_id'], Timestamp,
      LogAttributes['loyal.flow.outcome'] = 'started' AND LogAttributes['loyal.attempt.number'] = '1') AS release,
    minIf(Timestamp, LogAttributes['loyal.flow.outcome'] = 'started'
      AND LogAttributes['loyal.attempt.number'] = '1') AS entered,
    max(LogAttributes['loyal.flow.outcome'] = 'started'
      AND LogAttributes['loyal.attempt.number'] = '1') AS has_entry,
    max(LogAttributes['loyal.traffic.kind'] IN ('internal','synthetic')) AS excluded,
    max(LogAttributes['loyal.attempt.number'] = '1' AND
      (LogAttributes['loyal.error.category'] = 'technical' OR LogAttributes['loyal.flow.outcome'] = 'timed_out')) AS impaired,
    uniqExactIf(LogAttributes['loyal.user.id'], LogAttributes['loyal.user.id'] != '') AS identified_users
  FROM otel_logs
  WHERE Timestamp >= now() - INTERVAL 7 DAY AND Timestamp <= now()
    AND ServiceName = 'loyal-frontend'
    AND ResourceAttributes['deployment.environment.name'] IN ('production','prod')
    AND LogAttributes['loyal.event.kind'] = 'flow_lifecycle'
    AND LogAttributes['loyal.flow.source'] = 'browser'
    AND LogAttributes['loyal.journey.id'] != ''
  GROUP BY flow, journey
  HAVING has_entry AND NOT excluded AND entered <= now() - INTERVAL 10 MINUTE AND release != ''
), latest AS (
  SELECT flow, argMax(release, entered) AS latest_release FROM journeys GROUP BY flow
), recent AS (
  SELECT j.flow AS flow, j.release AS release, count() AS volume, sum(j.impaired) AS failures
  FROM journeys j INNER JOIN latest l ON j.flow = l.flow AND j.release = l.latest_release
  WHERE j.entered >= now() - INTERVAL 6 HOUR
  GROUP BY j.flow, j.release
), baseline AS (
  SELECT j.flow AS flow, count() AS volume, sum(j.impaired) AS failures
  FROM journeys j INNER JOIN latest l ON j.flow = l.flow
  WHERE j.release != l.latest_release AND j.entered < now() - INTERVAL 6 HOUR
  GROUP BY j.flow
), regressions AS (
  SELECT r.flow AS flow, r.release AS release, r.volume AS journeys, r.failures AS affected_journeys,
    r.failures / r.volume AS failure_rate,
    b.volume AS baseline_journeys,
    if(b.volume = 0, 0., b.failures / b.volume) AS baseline_rate
  FROM recent r LEFT JOIN baseline b ON r.flow = b.flow
  WHERE r.volume >= 10 AND r.failures >= 3 AND r.failures / r.volume >= 0.25
    AND (b.volume < 10 OR (r.failures / r.volume >= b.failures / b.volume * 2
      AND r.failures / r.volume >= b.failures / b.volume + 0.15))
)
SELECT count() AS regressed_flow_releases FROM regressions LIMIT 1
