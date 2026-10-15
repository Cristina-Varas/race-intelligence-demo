"""Execute notebook 14's pure preflight helpers; no Spark, OCI or ADB access."""
import ast
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK = ROOT / 'notebooks_aidp/14_publish_event_serving.ipynb'


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


@pytest.fixture
def helpers():
    scope = {'require': require}
    nb = json.loads(NOTEBOOK.read_text())
    for cell in nb['cells']:
        if 'serving_preflight_helpers' in cell.get('metadata', {}).get('tags', []):
            exec(compile(''.join(cell['source']), 'serving-preflight', 'exec'), scope)
    return scope


@pytest.fixture
def config():
    return dict(OCI_REGION='eu-frankfurt-1', OCI_OBJECT_STORAGE_NAMESPACE='testnamespace',
                OCI_EVENT_ARCHIVE_BUCKET='example-event-archive',
                OCI_EVENT_SERVING_PREFIX='race_intelligence_serving/gold_event')


def test_valid_prefix_accepts_underscores(helpers, config):
    assert helpers['serving_config'](config)[3] == config['OCI_EVENT_SERVING_PREFIX']


@pytest.mark.parametrize('prefix', ['bad?prefix', 'bad.prefix', 'bad prefix', 'x//y', '/', '../x', 'x/*', 'x/é'])
def test_invalid_prefix_not_masked_by_valid_region(helpers, config, prefix):
    config['OCI_EVENT_SERVING_PREFIX'] = prefix
    with pytest.raises(RuntimeError, match='Invalid serving prefix'):
        helpers['serving_config'](config)


def test_missing_environment_reports_all_names_without_values(helpers):
    with pytest.raises(RuntimeError) as error:
        helpers['serving_config']({'OCI_REGION': '  '})
    for name in helpers['SERVING_ENV']:
        assert name in str(error.value)
    assert 'Configure these variables explicitly' in str(error.value)


class VolumeSpark:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def sql(self, query):
        self.calls.append(query)
        assert query == 'DESCRIBE VOLUME race_intelligence.gold.serving'
        return SimpleNamespace(collect=lambda: [SimpleNamespace(asDict=lambda r=r: r) for r in self.rows])


@pytest.mark.parametrize('shape', ['wide', 'attributes'])
def test_actual_volume_metadata_matches_root_suffix(helpers, config, shape):
    location = 'oci://example-event-archive@testnamespace/race_intelligence_serving/'
    rows = [{'storage_location': location}] if shape == 'wide' else [{'Attribute': 'Location', 'Value': location}]
    spark = VolumeSpark(rows)
    result = helpers['verify_serving_volume'](spark, '/Volumes/race_intelligence/gold/serving/gold_event',
                                               helpers['serving_config'](config))
    assert result['mapping'] == 'VERIFIED' and len(spark.calls) == 1


@pytest.mark.parametrize('location', [
    'oci://wrong@testnamespace/race_intelligence_serving/',
    'oci://example-event-archive@wrong/race_intelligence_serving/',
    'oci://example-event-archive@testnamespace/wrong/',
    'https://example-event-archive@testnamespace/race_intelligence_serving/',
])
def test_volume_mismatch_fails_closed(helpers, config, location):
    with pytest.raises(RuntimeError):
        helpers['verify_serving_volume'](VolumeSpark([{'Location': location}]),
            '/Volumes/race_intelligence/gold/serving/gold_event', helpers['serving_config'](config))


@pytest.mark.parametrize('rows', [[], [{'unknown': 'oci://somewhere'}], [{'location': 'a'}, {'location': 'b'}]])
def test_unsupported_volume_metadata_actionable(helpers, rows):
    with pytest.raises(RuntimeError, match='Inspect its column names'):
        helpers['volume_location'](rows)


@pytest.mark.parametrize('publish,adb', [(None, None), ('false', 'true'), ('true', None), ('true', 'true'), ('TRUE', 'true')])
def test_independent_exact_gates(helpers, publish, adb):
    env = {'AIDP_EVENT_PUBLISH': publish, 'AIDP_EVENT_ADB_CUTOVER': adb}
    for function, value in [('require_publish', publish), ('require_adb_cutover', adb)]:
        if value == 'true':
            helpers[function](env)
        else:
            with pytest.raises(RuntimeError):
                helpers[function](env)


def publication_source():
    return next(''.join(c['source']) for c in json.loads(NOTEBOOK.read_text())['cells']
                if 'serving_publication' in c.get('metadata', {}).get('tags', []))


def test_actual_publication_stops_after_chain_when_publish_disabled(helpers):
    tree = ast.parse(publication_source())
    scope = {**helpers, 'os': SimpleNamespace(environ={'AIDP_EVENT_ADB_CUTOVER': 'true'}),
             'spark': object(), 'validate_all': lambda spark: {'chain': 'PASS'}}
    with pytest.raises(RuntimeError, match='AIDP_EVENT_PUBLISH=true'):
        exec(compile(tree, 'publication', 'exec'), scope)
    assert scope['validation'] == {'chain': 'PASS'}
    assert 'database' not in scope and 'contracts' not in scope


def test_actual_adb_block_stops_before_import_or_connection(helpers):
    tree = ast.parse(publication_source())
    index = next(i for i, n in enumerate(tree.body) if isinstance(n, ast.Expr)
                 and isinstance(n.value, ast.Call) and isinstance(n.value.func, ast.Name)
                 and n.value.func.id == 'require_adb_cutover')
    scope = {**helpers, 'os': SimpleNamespace(environ={'AIDP_EVENT_PUBLISH': 'true'})}
    with pytest.raises(RuntimeError, match='Autonomous NOT executed'):
        exec(compile(ast.Module(body=tree.body[index:], type_ignores=[]), 'adb-block', 'exec'), scope)
    assert 'Database' not in scope and 'database' not in scope


def test_products_immutable_generation_and_ddl_order():
    source = publication_source()
    tree = ast.parse(source)
    products = next(n.value for n in tree.body if isinstance(n, ast.Assign)
                    and any(isinstance(t, ast.Name) and t.id == 'products' for t in n.targets))
    assert {k.value for k in products.keys} == {
        'baseball_card_evidence', 'session_summary', 'standing_replay_feed', 'track_replay_feed'}
    assert source.index('verify_serving_volume(') < source.index('.parquet(target)')
    assert source.index('autonomous_cutover_plan') < source.index('require_adb_cutover(')
    assert source.index('require_adb_cutover(') < source.index('Database(Settings.from_env())') < source.index('DBMS_CLOUD.CREATE_EXTERNAL_TABLE')
    assert 'mode("errorifexists")' in source and '/_releases/{run_id}' in source
    assert 'exceptAll' in source and 'OCI$RESOURCE_PRINCIPAL' in source
    assert 'DROP TABLE' not in source and 'mode("overwrite")' not in source
    assert 'assert_private_free(df.columns)' in source and 'assert_private_free(restored.columns)' in source
    assert 'Autonomous factual card metric read-back mismatch' in source


def test_oracle_schema_checks_types_not_only_names(helpers):
    contract = {'table_name': 'DE_CARD_TEST', 'column_names': ['session_id', 'source_epoch'],
                'spark_types': ['string', 'bigint']}
    rows = [('SESSION_ID', 'VARCHAR2', 4000, None, None), ('SOURCE_EPOCH', 'NUMBER', 22, 19, 0)]
    helpers['verify_oracle_schema'](rows, contract)
    for bad in [('SOURCE_EPOCH', 'VARCHAR2', 4000, None, None), ('SOURCE_EPOCH', 'NUMBER', 22, 10, 0)]:
        with pytest.raises(RuntimeError, match='type/size/precision'):
            helpers['verify_oracle_schema']([rows[0], bad], contract)


@pytest.mark.parametrize('field', ['participant_name', 'photo_asset', 'display_name', 'field_performance_rank', 'laps_when_max_passed'])
def test_real_privacy_contract_rejects_identity_and_modelled_columns(field):
    nb = json.loads((ROOT / 'notebooks_aidp/10_event_capture_foundation.ipynb').read_text())
    tree = ast.parse(''.join(nb['cells'][1]['source']))
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'assert_private_free')
    scope = {'require': require}
    exec(compile(ast.Module(body=[node], type_ignores=[]), 'privacy', 'exec'), scope)
    with pytest.raises(RuntimeError, match='Identity/modelled'):
        scope['assert_private_free'](['logical_session_id', field])


def test_notebook_hygiene():
    nb = json.loads(NOTEBOOK.read_text())
    for cell in nb['cells']:
        source = ''.join(cell['source'])
        assert '/Users/' not in source and 'os.listdir' not in source
        if cell['cell_type'] == 'code':
            ast.parse(source)
            assert not cell.get('outputs') and cell.get('execution_count') is None
            assert 'os.environ["OCI_' not in source
            assert 'os.environ["AIDP_EVENT_' not in source
