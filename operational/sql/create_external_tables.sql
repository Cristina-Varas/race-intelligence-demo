-- PUBLIC COPY: supply the approved base URL outside Git; include its /o suffix.
DEFINE PUBLIC_OBJECT_STORAGE_BASE = 'CONFIGURE_OBJECT_STORAGE_BASE'
-- Race Intelligence serving-layer external tables.
-- Run as RACE_INTELLIGENCE in Autonomous Database Actions after notebook 09
-- has published the Parquet projections.
--
-- IMPORTANT: The AIDP Volume-to-bucket mapping is not stored in this repository.
-- Replace the value below with the verified Object Storage object prefix. It must
-- be URL encoded for any special object-name characters; keep / separators and
-- the trailing *.parquet wildcard unencoded.
DEFINE OCI_SERVING_PREFIX = 'REPLACE_WITH_VERIFIED_OBJECT_STORAGE_PREFIX'

-- Example only (do not use until verified in Object Storage):
-- race_intelligence_serving

BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE OBSERVED_DRIVER_PROFILES_EXT';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE != -942 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE VIRTUAL_MAX_PROFILE_EXT';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE != -942 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE MONTE_CARLO_SCENARIO_SUMMARY_EXT';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE != -942 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE MONTE_CARLO_PROBABILITY_CURVE_EXT';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE != -942 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE HISTORICAL_VARIABILITY_EXT';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE != -942 THEN RAISE; END IF;
END;
/

BEGIN
  DBMS_CLOUD.CREATE_EXTERNAL_TABLE(
    table_name      => 'OBSERVED_DRIVER_PROFILES_EXT',
    credential_name => 'OCI$RESOURCE_PRINCIPAL',
    file_uri_list   => '&PUBLIC_OBJECT_STORAGE_BASE./&OCI_SERVING_PREFIX./gold_historical/observed_driver_profiles/*.parquet',
    format          => JSON_OBJECT('type' VALUE 'parquet', 'schema' VALUE 'first')
  );

  DBMS_CLOUD.CREATE_EXTERNAL_TABLE(
    table_name      => 'VIRTUAL_MAX_PROFILE_EXT',
    credential_name => 'OCI$RESOURCE_PRINCIPAL',
    file_uri_list   => '&PUBLIC_OBJECT_STORAGE_BASE./&OCI_SERVING_PREFIX./gold_scenario/virtual_max_profile/*.parquet',
    format          => JSON_OBJECT('type' VALUE 'parquet', 'schema' VALUE 'first')
  );

  DBMS_CLOUD.CREATE_EXTERNAL_TABLE(
    table_name      => 'MONTE_CARLO_SCENARIO_SUMMARY_EXT',
    credential_name => 'OCI$RESOURCE_PRINCIPAL',
    file_uri_list   => '&PUBLIC_OBJECT_STORAGE_BASE./&OCI_SERVING_PREFIX./gold_scenario/monte_carlo_scenario_summary/*.parquet',
    format          => JSON_OBJECT('type' VALUE 'parquet', 'schema' VALUE 'first')
  );

  DBMS_CLOUD.CREATE_EXTERNAL_TABLE(
    table_name      => 'MONTE_CARLO_PROBABILITY_CURVE_EXT',
    credential_name => 'OCI$RESOURCE_PRINCIPAL',
    file_uri_list   => '&PUBLIC_OBJECT_STORAGE_BASE./&OCI_SERVING_PREFIX./gold_scenario/monte_carlo_probability_curve/*.parquet',
    format          => JSON_OBJECT('type' VALUE 'parquet', 'schema' VALUE 'first')
  );

  DBMS_CLOUD.CREATE_EXTERNAL_TABLE(
    table_name      => 'HISTORICAL_VARIABILITY_EXT',
    credential_name => 'OCI$RESOURCE_PRINCIPAL',
    file_uri_list   => '&PUBLIC_OBJECT_STORAGE_BASE./race_intelligence_serving/gold_historical/historical_variability/*.parquet',
    format          => JSON_OBJECT('type' VALUE 'parquet', 'schema' VALUE 'first')
  );
END;
/

-- Validation: inspect inferred schemas and row availability.
SELECT table_name, column_name, data_type
FROM user_tab_columns
WHERE table_name IN (
  'OBSERVED_DRIVER_PROFILES_EXT', 'VIRTUAL_MAX_PROFILE_EXT',
  'MONTE_CARLO_SCENARIO_SUMMARY_EXT', 'MONTE_CARLO_PROBABILITY_CURVE_EXT',
  'HISTORICAL_VARIABILITY_EXT'
)
ORDER BY table_name, column_id;

SELECT COUNT(*) AS observed_driver_profiles_rows FROM OBSERVED_DRIVER_PROFILES_EXT;
SELECT COUNT(*) AS virtual_max_profile_rows FROM VIRTUAL_MAX_PROFILE_EXT;
SELECT COUNT(*) AS monte_carlo_scenario_summary_rows FROM MONTE_CARLO_SCENARIO_SUMMARY_EXT;
SELECT COUNT(*) AS monte_carlo_probability_curve_rows FROM MONTE_CARLO_PROBABILITY_CURVE_EXT;
SELECT COUNT(*) AS historical_variability_rows FROM HISTORICAL_VARIABILITY_EXT;
SELECT MIN(lap_deviation) AS min_lap_deviation,
       MAX(lap_deviation) AS max_lap_deviation,
       AVG(lap_deviation) AS avg_lap_deviation
FROM HISTORICAL_VARIABILITY_EXT;

-- Display current operational scenario values. Do not use exact floating-point equality.
SELECT supported_field_size, race_laps, simulations,
       deterministic_max_delay_seconds, probability_at_zero_delay,
       delay_50pct, delay_80pct, delay_90pct
FROM MONTE_CARLO_SCENARIO_SUMMARY_EXT;

-- Expected validated operating range: field 16, 30 laps, 5000 simulations;
-- deterministic delay about 5.85, zero-delay probability about 0.5812,
-- P50 about 1.5, P80 about -4.5, P90 about -7.8.
SELECT COUNT(*) AS probability_values_outside_unit_interval
FROM MONTE_CARLO_PROBABILITY_CURVE_EXT
WHERE full_field_catch_probability NOT BETWEEN 0 AND 1;
