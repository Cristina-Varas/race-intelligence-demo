"""Notebook 12 state machine: fake catalog only, no Spark/OCI or row payloads."""
import ast
import copy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]


class Schema(list):
    def __init__(self, ddl):
        super().__init__()
        for column in ddl.split(','):
            name, kind = column.strip().split()
            kind = {'bigint': 'bigint', 'int': 'int'}.get(kind.lower(), kind.lower())
            self.append(SimpleNamespace(name=name, dataType=SimpleNamespace(simpleString=lambda k=kind: k)))

    def json(self):
        return json.dumps([(f.name, f.dataType.simpleString()) for f in self])


class FakeSpark:
    def __init__(self):
        self.tables = {}
        self.writes = []
        self.catalog = SimpleNamespace(tableExists=lambda name: name in self.tables)
        self.fail_create = False
        self.corrupt_rename = False
        self.generation = 0

    def add(self, name, ddl, rows=0):
        self.generation += 1
        self.tables[name] = dict(schema=Schema(ddl), rows=rows, id=f'id:{self.generation}',
                                 format='delta', location=f'location:{self.generation}', properties={})

    def createDataFrame(self, rows, ddl):
        return SimpleNamespace(schema=Schema(ddl))

    def table(self, name):
        state = self.tables[name]
        return SimpleNamespace(schema=state['schema'], count=lambda: state['rows'])

    def sql(self, sql):
        if sql.startswith('DESCRIBE DETAIL '):
            state = copy.deepcopy(self.tables[sql.split()[-1]])
            return SimpleNamespace(first=lambda: SimpleNamespace(asDict=lambda: state))
        self.writes.append(sql)
        if ' SET TBLPROPERTIES ' in sql:
            name = sql.split()[2]
            key, value = sql.split('(', 1)[1][:-1].split(' = ', 1)
            self.tables[name]['properties'][key.strip("'")] = value[1:-1].replace("''", "'")
        elif ' RENAME TO ' in sql:
            name, backup = sql.split()[2], sql.split()[-1]
            assert backup not in self.tables
            self.tables[backup] = self.tables.pop(name)
            if self.corrupt_rename:
                self.tables[backup]['rows'] += 1
        elif sql.startswith('CREATE TABLE '):
            if self.fail_create:
                raise RuntimeError('injected create interruption')
            name = sql.split()[2]
            assert name not in self.tables
            self.add(name, sql.split('(', 1)[1].rsplit(')', 1)[0])
        else:
            raise AssertionError('Unexpected mutation: ' + sql)


@pytest.fixture
def contract():
    # Extract only literal DDL constants and read-only schema helpers, not imports
    # or external configuration. Test the actual notebook migration implementation.
    foundation = json.loads((ROOT / 'notebooks_aidp/10_event_capture_foundation.ipynb').read_text())
    tree = ast.parse(''.join(foundation['cells'][1]['source']))
    wanted = {'EVENT_DDL', 'ROW_DDL', 'SILVER_TABLES'}
    nodes = [n for n in tree.body if
             (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in wanted for t in n.targets))
             or (isinstance(n, ast.FunctionDef) and n.name in {'require', 'check_schema'})]
    scope = dict(json=json, digest=lambda s: hashlib.sha256(s.encode()).hexdigest(),
                 packed=lambda value: json.dumps(value, sort_keys=True, separators=(',', ':')),
                 SILVER_SCHEMA='silver', table=lambda schema, name: f'race_intelligence.{schema}.{name}')
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'foundation-subset', 'exec'), scope)
    notebook = json.loads((ROOT / 'notebooks_aidp/12_event_capture_silver.ipynb').read_text())
    for cell in notebook['cells']:
        if 'silver_migration_helpers' in cell.get('metadata', {}).get('tags', []):
            exec(compile(''.join(cell['source']), 'migration-helpers', 'exec'), scope)
    return scope


def setup_legacy(contract):
    spark = FakeSpark()
    for name, ddl in contract['SILVER_TABLES'].items():
        spark.add('race_intelligence.silver.' + name, ddl)
    target = 'race_intelligence.silver.event_laps'
    spark.add(target, contract['LEGACY_LAPS_DDL'], rows=17)
    return spark, target


def test_default_reports_every_target_and_stops_without_writes(contract, capsys):
    spark, target = setup_legacy(contract)
    spark.tables['race_intelligence.silver.event_session']['schema'] = Schema('unknown STRING')
    report = contract['inspect_silver_contracts'](spark)
    assert len(report) == 10
    printed = capsys.readouterr().out
    for name in ['event_session', 'event_standings', 'event_laps', 'event_positions', 'event_finish_line']:
        assert 'race_intelligence.silver.' + name in printed
    assert contract['ALLOW_LEGACY_SILVER_MIGRATION'] is False
    with pytest.raises(RuntimeError, match='Unrecognized legacy contract'):
        contract['apply_silver_migration'](spark, report, False)
    assert not spark.writes


def test_approved_rename_and_second_run_preserve_original(contract):
    spark, target = setup_legacy(contract)
    original_id = spark.tables[target]['id']
    report = contract['inspect_silver_contracts'](spark)
    contract['apply_silver_migration'](spark, report, True)
    assert spark.tables[target]['rows'] == 0
    backup = target + '_legacy_pre_durable'
    assert spark.tables[backup]['rows'] == 17
    assert spark.tables[backup]['id'] == original_id
    first = contract['report_legacy_preservation'](spark, report)
    assert first[0]['legacy_pre_migration_rows'] == first[0]['legacy_post_migration_rows'] == 17
    writes = list(spark.writes)
    again = contract['inspect_silver_contracts'](spark)
    contract['apply_silver_migration'](spark, again, False)
    assert spark.writes == writes
    assert contract['report_legacy_preservation'](spark, again) == first


def test_interrupted_creation_resumes_only_with_receipt_and_approval(contract):
    spark, target = setup_legacy(contract)
    spark.fail_create = True
    with pytest.raises(RuntimeError, match='injected'):
        contract['apply_silver_migration'](spark, contract['inspect_silver_contracts'](spark), True)
    assert target not in spark.tables
    spark.fail_create = False
    report = contract['inspect_silver_contracts'](spark)
    with pytest.raises(RuntimeError, match='Approval required to resume'):
        contract['apply_silver_migration'](spark, report, False)
    contract['apply_silver_migration'](spark, report, True)
    assert sum(' RENAME TO ' in s for s in spark.writes) == 1
    assert spark.tables[target + '_legacy_pre_durable']['rows'] == 17


@pytest.mark.parametrize('kind', ['unknown', 'backup_conflict', 'missing_receipt', 'not_delta'])
def test_unsafe_states_fail_before_any_write(contract, kind):
    spark, target = setup_legacy(contract)
    if kind == 'unknown':
        spark.tables[target]['schema'] = Schema('unknown STRING')
    elif kind in {'backup_conflict', 'missing_receipt'}:
        spark.add(target + '_legacy_pre_durable', contract['LEGACY_LAPS_DDL'], rows=17)
        if kind == 'missing_receipt':
            del spark.tables[target]
    else:
        spark.tables[target]['format'] = 'parquet'
    with pytest.raises(RuntimeError):
        contract['apply_silver_migration'](spark, contract['inspect_silver_contracts'](spark), True)
    assert not spark.writes


def test_concurrent_change_stops_before_mutation(contract):
    spark, target = setup_legacy(contract)
    report = contract['inspect_silver_contracts'](spark)
    spark.tables[target]['rows'] += 1
    with pytest.raises(RuntimeError, match='Concurrent'):
        contract['apply_silver_migration'](spark, report, True)
    assert not spark.writes


def test_missing_tables_created_without_legacy_migration(contract):
    spark = FakeSpark()
    report = contract['inspect_silver_contracts'](spark)
    assert all(item['classification'] == 'MISSING' for item in report)
    contract['apply_silver_migration'](spark, report, False)
    assert len(spark.tables) == 10
    assert all(statement.startswith('CREATE TABLE') for statement in spark.writes)


def test_metadata_error_does_not_hide_other_contracts(contract, capsys):
    spark, target = setup_legacy(contract)
    original = spark.sql

    def deny_one(sql):
        if sql == 'DESCRIBE DETAIL race_intelligence.silver.event_session':
            raise PermissionError('blocked')
        return original(sql)

    spark.sql = deny_one
    report = contract['inspect_silver_contracts'](spark)
    assert len(report) == 10
    assert 'race_intelligence.silver.event_finish_line' in capsys.readouterr().out
    with pytest.raises(RuntimeError, match='Metadata inspection failed'):
        contract['apply_silver_migration'](spark, report, True)
    assert not spark.writes


def test_unknown_second_collision_blocks_known_laps_migration(contract):
    spark, target = setup_legacy(contract)
    spark.tables['race_intelligence.silver.event_finish_line']['schema'] = Schema('old STRING')
    with pytest.raises(RuntimeError, match='Unrecognized legacy contract'):
        contract['apply_silver_migration'](spark, contract['inspect_silver_contracts'](spark), True)
    assert not spark.writes


def test_compatible_canonical_cannot_alias_backup_storage(contract):
    spark, target = setup_legacy(contract)
    contract['apply_silver_migration'](spark, contract['inspect_silver_contracts'](spark), True)
    spark.tables[target]['location'] = spark.tables[target + '_legacy_pre_durable']['location']
    writes = list(spark.writes)
    with pytest.raises(RuntimeError, match='aliases preserved storage'):
        contract['apply_silver_migration'](spark, contract['inspect_silver_contracts'](spark), False)
    assert spark.writes == writes


def test_backup_count_tampering_fails_closed_on_rerun(contract):
    spark, target = setup_legacy(contract)
    contract['apply_silver_migration'](spark, contract['inspect_silver_contracts'](spark), True)
    spark.tables[target + '_legacy_pre_durable']['rows'] += 1
    writes = list(spark.writes)
    with pytest.raises(RuntimeError, match='receipt'):
        contract['apply_silver_migration'](spark, contract['inspect_silver_contracts'](spark), False)
    assert spark.writes == writes


def test_changed_backup_after_rename_stops_before_creation(contract):
    spark, target = setup_legacy(contract)
    spark.corrupt_rename = True
    with pytest.raises(RuntimeError, match='receipt'):
        contract['apply_silver_migration'](spark, contract['inspect_silver_contracts'](spark), True)
    assert not any(s.startswith('CREATE') for s in spark.writes)


def test_notebook_syntax_and_source_route():
    for name in ['12_event_capture_silver', '99_aidp_validation']:
        nb = json.loads((ROOT / 'notebooks_aidp' / (name + '.ipynb')).read_text())
        for cell in nb['cells']:
            if cell['cell_type'] == 'code':
                source = ''.join(cell['source'])
                ast.parse(source)
                assert 'DROP TABLE' not in source.upper()
                assert 'INSERT OVERWRITE' not in source.upper()
                assert '.mode("overwrite")' not in source
    population = next(''.join(c['source']) for c in json.loads((ROOT / 'notebooks_aidp/12_event_capture_silver.ipynb').read_text())['cells']
                      if 'silver_population' in c.get('metadata', {}).get('tags', []))
    assert population.index('bronze_input(spark)') < population.index('apply_silver_migration(')
    assert population.index('equal_rows(') < population.index('apply_silver_migration(')
    assert '_legacy_pre_durable' not in population
    assert 'merge_rows(' in population and 'equal_rows(' in population
