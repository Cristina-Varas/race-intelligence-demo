-- Read-only application views over the OCI Object Storage external tables.
-- Run this script after sql/create_external_tables.sql as RACE_INTELLIGENCE.

CREATE OR REPLACE VIEW V_RACE_SCENARIO_SUMMARY AS
SELECT supported_field_size AS "supportedFieldSize",
       race_laps AS "raceLaps",
       simulations AS "simulations",
       deterministic_max_delay_seconds AS "deterministicMaxDelaySeconds",
       probability_at_zero_delay AS "probabilityAtZeroDelay",
       delay_50pct AS "p50",
       delay_80pct AS "p80",
       delay_90pct AS "p90"
FROM MONTE_CARLO_SCENARIO_SUMMARY_EXT;

CREATE OR REPLACE VIEW V_RACE_PROBABILITY_CURVE AS
SELECT delay_seconds AS "delaySeconds",
       full_field_catch_probability AS "catchProbability"
FROM MONTE_CARLO_PROBABILITY_CURVE_EXT;

CREATE OR REPLACE VIEW V_VIRTUAL_MAX AS
SELECT scenario_driver_id AS "scenarioDriverId",
       reference_driver_id AS "referenceDriverId",
       reference_pace_seconds AS "referencePaceSeconds",
       assumed_advantage_seconds_per_lap AS "assumedAdvantageSecondsPerLap",
       virtual_max_pace_seconds AS "virtualMaxPaceSeconds",
       scenario_type AS "scenarioType",
       label AS "label",
       historical_status AS "historicalStatus"
FROM VIRTUAL_MAX_PROFILE_EXT;

CREATE OR REPLACE VIEW V_OBSERVED_DRIVER_PROFILES AS
SELECT driver_id AS "driverId",
       pooled_median_pace AS "pooledMedianPace",
       support_status AS "supportStatus"
FROM OBSERVED_DRIVER_PROFILES_EXT;

-- Historical uncertainty input for transient FastAPI what-if calculations.
-- It stays distinct from the synthetic scenario views and is never written by
-- the application.
CREATE OR REPLACE VIEW V_HISTORICAL_VARIABILITY AS
SELECT lap_deviation AS "lapDeviation"
FROM HISTORICAL_VARIABILITY_EXT;

-- Application-facing validation queries.
SELECT * FROM V_RACE_SCENARIO_SUMMARY;
SELECT * FROM V_RACE_PROBABILITY_CURVE ORDER BY "delaySeconds";
SELECT * FROM V_VIRTUAL_MAX;
SELECT * FROM V_OBSERVED_DRIVER_PROFILES ORDER BY "pooledMedianPace";
SELECT * FROM V_HISTORICAL_VARIABILITY FETCH FIRST 10 ROWS ONLY;
