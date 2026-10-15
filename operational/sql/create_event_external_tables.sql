-- PUBLIC COPY: supply the approved base URL outside Git; include its /o suffix.
DEFINE PUBLIC_OBJECT_STORAGE_BASE = 'CONFIGURE_OBJECT_STORAGE_BASE'
-- Actual Event Gold serving external tables and views.
-- Run as RACE_INTELLIGENCE in Autonomous Database Actions after
-- notebooks_aidp/14_publish_event_serving.ipynb has published Gold Event Parquet.
--
-- This follows sql/create_external_tables.sql for DBMS_CLOUD use,
-- OCI$RESOURCE_PRINCIPAL and Frankfurt Object Storage URI style.  Unlike the
-- earlier schema='first' form, each external table has an explicit additive
-- Event Contract 1.0 projection.  That makes re-creation safe when OPTIONAL
-- products have no Parquet objects: no schema inference from a missing file is
-- required, and no artificial business rows are published.
--
-- Actual Event is separate from historical and synthetic serving domains.
-- This script creates only new EVENT_* external tables and V_EVENT_* views.

DEFINE OCI_SERVING_PREFIX = 'race_intelligence_serving'

-- The configured Object Storage location is:
--   https://CONFIGURE_OBJECT_STORAGE_HOST/n/CONFIGURE_NAMESPACE/
--   b/CONFIGURE_BUCKET/o/race_intelligence_serving/gold_event/
-- The slash after the substitution variable is part of the Object Storage key.
-- Do not use a substitution-variable terminator dot here: it becomes a literal
-- key character in Autonomous and prevents the Parquet wildcard from matching.
-- Keep slash separators and the trailing *.parquet wildcard unencoded.

BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE EVENT_RACE_SUMMARY_EXT';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE != -942 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE EVENT_PARTICIPANT_RACE_SUMMARY_EXT';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE != -942 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE EVENT_PREDICTION_VS_REALITY_EXT';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE != -942 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE EVENT_PARTICIPANT_CARD_FEED_EXT';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE != -942 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE EVENT_STORYLINE_EXT';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE != -942 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE EVENT_STANDING_REPLAY_EXT';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF;
END;
/
BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE EVENT_TRACK_REPLAY_EXT';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF;
END;
/

BEGIN
  DBMS_CLOUD.CREATE_EXTERNAL_TABLE(
    table_name      => 'EVENT_RACE_SUMMARY_EXT',
    credential_name => 'OCI$RESOURCE_PRINCIPAL',
    file_uri_list   => '&PUBLIC_OBJECT_STORAGE_BASE./&OCI_SERVING_PREFIX/gold_event/race_summary/*.parquet',
    column_list     => 'session_id VARCHAR2(32767), event_id VARCHAR2(32767), session_type VARCHAR2(32767), session_name VARCHAR2(32767), status VARCHAR2(32767), started_at TIMESTAMP(9), ended_at TIMESTAMP(9), session_duration_seconds BINARY_DOUBLE, participant_count NUMBER(19), lap_observation_count NUMBER(19), distinct_lap_count NUMBER(19), event_count NUMBER(19), media_marker_count NUMBER(19), snapshot_count NUMBER(19), max_participant_id VARCHAR2(32767), max_best_lap_seconds BINARY_DOUBLE, max_average_lap_seconds BINARY_DOUBLE, max_completed_laps NUMBER(19), fastest_participant_id VARCHAR2(32767), fastest_participant_name VARCHAR2(32767), fastest_lap_seconds BINARY_DOUBLE, final_leader_participant_id VARCHAR2(32767), final_leader_name VARCHAR2(32767), final_leader_position NUMBER(10), source VARCHAR2(32767), gold_processed_at TIMESTAMP(9), operational_context VARCHAR2(32767), factual_evidence_domain VARCHAR2(32767), event_contract_version VARCHAR2(32767)',
    format          => JSON_OBJECT('type' VALUE 'parquet')
  );

  DBMS_CLOUD.CREATE_EXTERNAL_TABLE(
    table_name      => 'EVENT_PARTICIPANT_RACE_SUMMARY_EXT',
    credential_name => 'OCI$RESOURCE_PRINCIPAL',
    file_uri_list   => '&PUBLIC_OBJECT_STORAGE_BASE./&OCI_SERVING_PREFIX/gold_event/participant_race_summary/*.parquet',
    column_list     => 'session_id VARCHAR2(32767), participant_id VARCHAR2(32767), display_name VARCHAR2(32767), kart_id VARCHAR2(32767), participant_type VARCHAR2(32767), special_role VARCHAR2(32767), lap_count NUMBER(19), best_lap_seconds BINARY_DOUBLE, average_lap_seconds BINARY_DOUBLE, median_lap_seconds BINARY_DOUBLE, total_recorded_lap_time_seconds BINARY_DOUBLE, initial_position NUMBER(10), final_position NUMBER(10), position_change NUMBER(10), first_observed_at TIMESTAMP(9), last_observed_at TIMESTAMP(9), timing_catch_lap NUMBER(10), timing_catch_time_seconds BINARY_DOUBLE, physical_pass_lap NUMBER(10), physical_pass_time_seconds BINARY_DOUBLE, joker_count NUMBER(19), incident_count NUMBER(19), spin_count NUMBER(19), penalty_count NUMBER(19), media_marker_count NUMBER(19), source VARCHAR2(32767), gold_processed_at TIMESTAMP(9), external_participant_number VARCHAR2(32767), operational_context VARCHAR2(32767), evidence_domain VARCHAR2(32767), event_contract_version VARCHAR2(32767)',
    format          => JSON_OBJECT('type' VALUE 'parquet')
  );

  DBMS_CLOUD.CREATE_EXTERNAL_TABLE(
    table_name      => 'EVENT_PREDICTION_VS_REALITY_EXT',
    credential_name => 'OCI$RESOURCE_PRINCIPAL',
    file_uri_list   => '&PUBLIC_OBJECT_STORAGE_BASE./&OCI_SERVING_PREFIX/gold_event/prediction_vs_reality/*.parquet',
    column_list     => 'session_id VARCHAR2(32767), scenario_snapshot_id VARCHAR2(32767), snapshot_type VARCHAR2(32767), model_version VARCHAR2(32767), git_commit VARCHAR2(32767), predicted_vm_finish_seconds BINARY_DOUBLE, actual_vm_finish_seconds BINARY_DOUBLE, finish_time_error_seconds BINARY_DOUBLE, predicted_vm_rank NUMBER(10), actual_vm_rank NUMBER(10), rank_error NUMBER(10), predicted_p1_lap NUMBER(10), actual_p1_lap NUMBER(10), p1_lap_error NUMBER(10), predicted_p1_time_seconds BINARY_DOUBLE, actual_p1_time_seconds BINARY_DOUBLE, p1_time_error_seconds BINARY_DOUBLE, predicted_full_field_catch_lap NUMBER(10), actual_full_field_catch_lap NUMBER(10), full_field_catch_lap_error NUMBER(10), predicted_full_field_catch_time_seconds BINARY_DOUBLE, actual_full_field_catch_time_seconds BINARY_DOUBLE, full_field_catch_time_error_seconds BINARY_DOUBLE, predicted_timing_caught NUMBER(10), actual_timing_caught NUMBER(19), predicted_cleared NUMBER(10), actual_cleared NUMBER(19), prediction_available NUMBER(1), actual_available NUMBER(1), comparison_available NUMBER(1), gold_processed_at TIMESTAMP(9), operational_context VARCHAR2(32767), prediction_source VARCHAR2(32767), prediction_evidence_domain VARCHAR2(32767), actual_evidence_domain VARCHAR2(32767), event_contract_version VARCHAR2(32767)',
    format          => JSON_OBJECT('type' VALUE 'parquet')
  );

  DBMS_CLOUD.CREATE_EXTERNAL_TABLE(
    table_name      => 'EVENT_PARTICIPANT_CARD_FEED_EXT',
    credential_name => 'OCI$RESOURCE_PRINCIPAL',
    file_uri_list   => '&PUBLIC_OBJECT_STORAGE_BASE./&OCI_SERVING_PREFIX/gold_event/participant_card_feed/*.parquet',
    column_list     => 'session_id VARCHAR2(32767), participant_id VARCHAR2(32767), display_name VARCHAR2(32767), kart_id VARCHAR2(32767), participant_type VARCHAR2(32767), special_role VARCHAR2(32767), actual_start_position NUMBER(10), actual_final_position NUMBER(10), position_change NUMBER(10), actual_best_lap_seconds BINARY_DOUBLE, actual_average_lap_seconds BINARY_DOUBLE, actual_completed_laps NUMBER(19), held_max_off_laps NUMBER(10), held_max_off_seconds BINARY_DOUBLE, timing_catch_lap NUMBER(10), timing_catch_time_seconds BINARY_DOUBLE, physical_pass_lap NUMBER(10), physical_pass_time_seconds BINARY_DOUBLE, joker_count NUMBER(19), predicted_catch_lap NUMBER(10), predicted_final_position NUMBER(10), prediction_error_seconds BINARY_DOUBLE, highlight_title VARCHAR2(32767), highlight_text VARCHAR2(32767), data_provenance VARCHAR2(32767), card_data_status VARCHAR2(32767), gold_processed_at TIMESTAMP(9), external_participant_number VARCHAR2(32767), operational_context VARCHAR2(32767), evidence_domain VARCHAR2(32767), event_contract_version VARCHAR2(32767)',
    format          => JSON_OBJECT('type' VALUE 'parquet')
  );

  DBMS_CLOUD.CREATE_EXTERNAL_TABLE(
    table_name      => 'EVENT_STORYLINE_EXT',
    credential_name => 'OCI$RESOURCE_PRINCIPAL',
    file_uri_list   => '&PUBLIC_OBJECT_STORAGE_BASE./&OCI_SERVING_PREFIX/gold_event/event_storyline/*.parquet',
    column_list     => 'storyline_id VARCHAR2(32767), session_id VARCHAR2(32767), race_time_seconds BINARY_DOUBLE, lap_number NUMBER(10), participant_id VARCHAR2(32767), target_participant_id VARCHAR2(32767), story_type VARCHAR2(32767), story_category VARCHAR2(32767), title VARCHAR2(32767), description VARCHAR2(32767), priority VARCHAR2(32767), source_record_type VARCHAR2(32767), source_record_id VARCHAR2(32767), gold_processed_at TIMESTAMP(9), source VARCHAR2(32767), operational_context VARCHAR2(32767), evidence_domain VARCHAR2(32767), event_contract_version VARCHAR2(32767)',
    format          => JSON_OBJECT('type' VALUE 'parquet')
  );

  DBMS_CLOUD.CREATE_EXTERNAL_TABLE(
    table_name => 'EVENT_STANDING_REPLAY_EXT',
    credential_name => 'OCI$RESOURCE_PRINCIPAL',
    file_uri_list => '&PUBLIC_OBJECT_STORAGE_BASE./&OCI_SERVING_PREFIX/gold_event/standing_replay_feed/*.parquet',
    column_list => 'session_id VARCHAR2(32767), snapshot_id VARCHAR2(32767), source_snapshot_key VARCHAR2(32767), participant_id VARCHAR2(32767), external_participant_number VARCHAR2(32767), observed_at TIMESTAMP(9), source_timestamp TIMESTAMP(9), recorded_at TIMESTAMP(9), ingested_at TIMESTAMP(9), position NUMBER(10), lap_number NUMBER(10), elapsed_time_seconds BINARY_DOUBLE, gap_first_seconds BINARY_DOUBLE, gap_first_laps NUMBER(10), gap_previous_seconds BINARY_DOUBLE, gap_previous_laps NUMBER(10), status VARCHAR2(32767), position_change NUMBER(10), at_loop VARCHAR2(32767), source VARCHAR2(32767), operational_context VARCHAR2(32767), evidence_domain VARCHAR2(32767), event_contract_version VARCHAR2(32767)',
    format => JSON_OBJECT('type' VALUE 'parquet')
  );
  DBMS_CLOUD.CREATE_EXTERNAL_TABLE(
    table_name => 'EVENT_TRACK_REPLAY_EXT',
    credential_name => 'OCI$RESOURCE_PRINCIPAL',
    file_uri_list => '&PUBLIC_OBJECT_STORAGE_BASE./&OCI_SERVING_PREFIX/gold_event/track_replay_feed/*.parquet',
    column_list => 'session_id VARCHAR2(32767), sample_id VARCHAR2(32767), source_entity_id VARCHAR2(32767), participant_id VARCHAR2(32767), external_participant_number VARCHAR2(32767), observed_at TIMESTAMP(9), source_timestamp TIMESTAMP(9), recorded_at TIMESTAMP(9), ingested_at TIMESTAMP(9), position_source VARCHAR2(32767), latitude BINARY_DOUBLE, longitude BINARY_DOUBLE, raw_status_bits NUMBER(19), unknown_status_bits NUMBER(19), is_official_car NUMBER(1), is_leader NUMBER(1), is_lapped NUMBER(1), is_class_leader NUMBER(1), is_stopped NUMBER(1), is_class_lapped NUMBER(1), is_in_pit NUMBER(1), is_out_lap NUMBER(1), is_position_unknown NUMBER(1), is_retired NUMBER(1), is_late NUMBER(1), is_entry_list_target NUMBER(1), is_no_gps NUMBER(1), is_chequered NUMBER(1), source VARCHAR2(32767), operational_context VARCHAR2(32767), evidence_domain VARCHAR2(32767), event_contract_version VARCHAR2(32767)',
    format => JSON_OBJECT('type' VALUE 'parquet')
  );
END;
/

-- Read-only serving views. SELECT * preserves Actual Event field names,
-- nullability, TIMING_CATCH/pass distinction, and ACTUAL_EVENT provenance.
CREATE OR REPLACE VIEW V_EVENT_RACE_SUMMARY AS
SELECT * FROM EVENT_RACE_SUMMARY_EXT;

CREATE OR REPLACE VIEW V_EVENT_PARTICIPANT_RACE_SUMMARY AS
SELECT * FROM EVENT_PARTICIPANT_RACE_SUMMARY_EXT;

CREATE OR REPLACE VIEW V_EVENT_PREDICTION_VS_REALITY AS
SELECT * FROM EVENT_PREDICTION_VS_REALITY_EXT;

CREATE OR REPLACE VIEW V_EVENT_PARTICIPANT_CARD_FEED AS
SELECT * FROM EVENT_PARTICIPANT_CARD_FEED_EXT;

CREATE OR REPLACE VIEW V_EVENT_STORYLINE AS
SELECT * FROM EVENT_STORYLINE_EXT;

CREATE OR REPLACE VIEW V_EVENT_STANDING_REPLAY AS SELECT * FROM EVENT_STANDING_REPLAY_EXT;
CREATE OR REPLACE VIEW V_EVENT_TRACK_REPLAY AS SELECT * FROM EVENT_TRACK_REPLAY_EXT;

-- Phase C replay validation (REHEARSAL_AKS_4040): 182736 / 503535 total rows,
-- latest standings 36, GPS_CORRECTED 255330, RGPS_RAW 248205, SC 6708.
SELECT COUNT(*) FROM V_EVENT_STANDING_REPLAY;
SELECT COUNT(*) FROM V_EVENT_TRACK_REPLAY;
SELECT position_source, COUNT(*) FROM V_EVENT_TRACK_REPLAY GROUP BY position_source;
SELECT COUNT(*) FROM V_EVENT_TRACK_REPLAY WHERE source_entity_id = 'SC' AND participant_id IS NULL AND external_participant_number IS NULL;
SELECT COUNT(*) FROM V_EVENT_TRACK_REPLAY WHERE source_timestamp IS NOT NULL OR observed_at != recorded_at;

-- Validation: inspect inferred external schemas and serving row counts.
SELECT table_name, column_name, data_type
FROM user_tab_columns
WHERE table_name IN (
  'EVENT_RACE_SUMMARY_EXT',
  'EVENT_PARTICIPANT_RACE_SUMMARY_EXT',
  'EVENT_PREDICTION_VS_REALITY_EXT',
  'EVENT_PARTICIPANT_CARD_FEED_EXT',
  'EVENT_STORYLINE_EXT'
)
ORDER BY table_name, column_id;

SELECT COUNT(*) AS event_race_summary_rows FROM V_EVENT_RACE_SUMMARY;
SELECT COUNT(*) AS event_participant_race_summary_rows FROM V_EVENT_PARTICIPANT_RACE_SUMMARY;
SELECT COUNT(*) AS event_prediction_vs_reality_rows FROM V_EVENT_PREDICTION_VS_REALITY;
SELECT COUNT(*) AS event_participant_card_feed_rows FROM V_EVENT_PARTICIPANT_CARD_FEED;
SELECT COUNT(*) AS event_storyline_rows FROM V_EVENT_STORYLINE;

-- Current AKS rehearsal validation expectations: 1, 36, 0, 36, 0 respectively.
SELECT *
FROM V_EVENT_RACE_SUMMARY
WHERE session_id = 'REHEARSAL_AKS_4040';

SELECT *
FROM V_EVENT_PARTICIPANT_RACE_SUMMARY
WHERE session_id = 'REHEARSAL_AKS_4040'
ORDER BY participant_id;

SELECT *
FROM V_EVENT_PREDICTION_VS_REALITY
WHERE session_id = 'REHEARSAL_AKS_4040';

SELECT *
FROM V_EVENT_PARTICIPANT_CARD_FEED
WHERE session_id = 'REHEARSAL_AKS_4040'
ORDER BY participant_id;

SELECT *
FROM V_EVENT_STORYLINE
WHERE session_id = 'REHEARSAL_AKS_4040'
ORDER BY race_time_seconds, source_record_id;
