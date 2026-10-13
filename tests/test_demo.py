import copy
import importlib.util
import json
import math
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from race_demo.pipeline import (build_gold, build_silver, canonical, digest,
                                generate_bronze, serving_document, simulate, write_once)
from race_demo.server import validate_serving
from race_demo.workbench import publish_table, table_name

ROOT = Path(__file__).resolve().parents[1]


class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bronze = generate_bronze()
        cls.silver = build_silver(cls.bronze)
        cls.gold = build_gold(cls.silver)

    def test_generator_is_reproducible_and_fictional(self):
        self.assertEqual(self.bronze, generate_bronze())
        self.assertEqual(len(self.bronze), 768)
        self.assertEqual(len({r['driver_id'] for r in self.bronze}), 16)
        self.assertTrue(all(r['evidence_type'] == 'SYNTHETIC_DEMO' for r in self.bronze))

    def test_silver_normalizes_order_without_mutation(self):
        rows = list(reversed(self.bronze))
        original = copy.deepcopy(rows)
        self.assertEqual(build_silver(rows), self.silver)
        self.assertEqual(rows, original)

    def test_rejects_duplicate_missing_or_non_demo_rows(self):
        for mutation in ('duplicate', 'missing', 'identity', 'nonfinite', 'extra', 'altered'):
            with self.subTest(mutation=mutation):
                rows = copy.deepcopy(self.bronze)
                if mutation == 'duplicate': rows[1] = dict(rows[0])
                if mutation == 'missing': rows.pop()
                if mutation == 'identity': rows[0]['driver_id'] = 'REAL_PERSON'
                if mutation == 'nonfinite': rows[0]['lap_seconds'] = math.nan
                if mutation == 'extra': rows[0]['unexpected'] = 'value'
                if mutation == 'altered': rows[0]['lap_seconds'] += .01
                with self.assertRaises(ValueError): build_silver(rows)

    def test_gold_counts_and_finite_values(self):
        self.assertEqual(len(self.gold['profiles']), 16)
        self.assertEqual(len(self.gold['deviations']), 768)
        self.assertTrue(all(p['lap_count'] == 48 for p in self.gold['profiles']))
        self.assertTrue(all(math.isfinite(d) for d in self.gold['deviations']))

    def test_scenarios_reproducible_probabilities_monotonic(self):
        for size in (16, 100):
            with self.subTest(size=size):
                result = simulate(self.gold, field_size=size, simulations=100)
                self.assertEqual(result, simulate(self.gold, field_size=size, simulations=100))
                self.assertEqual(len(result['drivers']), size)
                probabilities = [p['catchProbability'] for p in result['curve']]
                self.assertTrue(all(0 <= p <= 1 for p in probabilities))
                self.assertEqual(probabilities, sorted(probabilities, reverse=True))
                self.assertEqual(result['evidence_type'], 'SYNTHETIC_DEMO')

    def test_closed_form_delay_limit(self):
        result = simulate(self.gold, race_laps=20, advantage=.5, simulations=100)
        self.assertAlmostEqual(result['deterministic_max_delay_seconds'], 10)

    def test_public_parameter_bounds(self):
        for args in ({'field_size':101}, {'race_laps':0}, {'simulations':0},
                     {'simulations':5001}, {'delay':math.inf}, {'delay':True},
                     {'advantage':0}, {'race_laps':True}, {'field_size':16.0}):
            with self.subTest(args=args):
                with self.assertRaises(ValueError): simulate(self.gold, **args)

    def test_identical_artifacts_idempotent_and_conflicts_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.json'
            write_once(path, {'value':1})
            initial = path.read_bytes()
            write_once(path, {'value':1})
            with self.assertRaises(ValueError): write_once(path, {'value':2})
            self.assertEqual(path.read_bytes(), initial)

    def test_serving_parity_and_tamper_rejection(self):
        document = serving_document(self.bronze, self.silver, self.gold, simulations=100)
        self.assertEqual(validate_serving(document), document)
        altered = copy.deepcopy(document)
        altered['scenarios']['16']['full_field_probability'] = -1
        with self.assertRaises(ValueError): validate_serving(altered)

    def test_layer_parity(self):
        gold = copy.deepcopy(self.gold)
        gold['profiles'][0]['pace_seconds'] += 1
        with self.assertRaises(ValueError): serving_document(self.bronze, self.silver, gold, simulations=100)

    def test_local_and_workbench_labels_do_not_change_calculation(self):
        local = serving_document(self.bronze, self.silver, self.gold, simulations=100)
        cloud = serving_document(self.bronze, self.silver, self.gold, execution='AIDP_WORKBENCH', simulations=100)
        self.assertEqual(local['scenarios'], cloud['scenarios'])
        self.assertNotEqual(local['execution'], cloud['execution'])


class FakeRow(dict):
    def asDict(self, recursive=False): return dict(self)


class FakeFrame:
    def __init__(self, spark, rows): self.spark, self.rows = spark, rows
    @property
    def write(self): return self
    def format(self, value):
        assert value == 'delta'
        return self
    def mode(self, value):
        assert value == 'errorifexists'
        return self
    def saveAsTable(self, name):
        if name in self.spark.tables: raise RuntimeError('already exists')
        self.spark.tables[name] = copy.deepcopy(self.rows)
        self.spark.writes += 1
    def collect(self): return [FakeRow(row) for row in self.rows]


class FakeSpark:
    def __init__(self): self.tables, self.writes, self.catalog = {}, 0, self
    def tableExists(self, name): return name in self.tables
    def createDataFrame(self, rows): return FakeFrame(self, rows)
    def table(self, name): return FakeFrame(self, self.tables[name])


class PublicationTests(unittest.TestCase):
    def test_table_namespace_guard(self):
        for value in ('', 'production', 'a.b.c_demo', 'demo; DROP', '../demo'):
            with self.subTest(value=value), patch.dict(os.environ, {'AIDP_DEMO_SCHEMA':value}):
                with self.assertRaises(ValueError): table_name('bronze')
        with patch.dict(os.environ, {'AIDP_DEMO_SCHEMA':'catalog.racing_demo'}):
            self.assertEqual(table_name('bronze'), 'catalog.racing_demo.race_intelligence_bronze_v1')
            with self.assertRaises(ValueError): table_name('arbitrary')

    def test_mocked_delta_idempotency_and_conflict(self):
        spark = FakeSpark()
        with patch.dict(os.environ, {'AIDP_DEMO_SCHEMA':'racing_demo'}):
            first = publish_table(spark, 'bronze', [{'lap':1}])
            self.assertEqual(publish_table(spark, 'bronze', [{'lap':1}]), first)
            self.assertEqual(spark.writes, 1)
            with self.assertRaises(ValueError): publish_table(spark, 'bronze', [{'lap':2}])
            self.assertEqual(spark.writes, 1)
            self.assertEqual(spark.tables[table_name('bronze')], [{'lap':1}])


class NotebookTests(unittest.TestCase):
    def test_notebooks_output_free_and_syntax_valid(self):
        notebooks = sorted((ROOT / 'notebooks_aidp').glob('*.ipynb'))
        self.assertEqual(len(notebooks), 6)
        for path in notebooks:
            for cell in json.loads(path.read_text())['cells']:
                if cell['cell_type'] == 'code':
                    self.assertEqual(cell['outputs'], [])
                    self.assertIsNone(cell['execution_count'])
                    compile(''.join(cell['source']), str(path.name), 'exec')

    def test_all_notebooks_execute_in_local_mode_twice(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            'AIDP_PROJECT_ROOT':str(ROOT), 'RACE_DEMO_OUTPUT':directory,
            'RACE_DEMO_EXECUTION':'LOCAL_DEMO',
        }):
            for _ in range(2):
                for path in sorted((ROOT / 'notebooks_aidp').glob('*.ipynb')):
                    namespace = {}
                    for cell in json.loads(path.read_text())['cells']:
                        if cell['cell_type'] == 'code':
                            exec(compile(''.join(cell['source']), path.name, 'exec'), namespace)
            artifact = json.loads((Path(directory) / 'serving/demo.json').read_text())
            self.assertEqual(artifact['execution'], 'LOCAL_DEMO')

    def test_workbench_fails_without_spark(self):
        notebook = json.loads((ROOT / 'notebooks_aidp/00_environment.ipynb').read_text())
        with patch.dict(os.environ, {'AIDP_PROJECT_ROOT':str(ROOT), 'RACE_DEMO_EXECUTION':'AIDP_WORKBENCH'}):
            with self.assertRaises(RuntimeError): exec(''.join(notebook['cells'][1]['source']), {})


class PublicContentTests(unittest.TestCase):
    def test_detector_redacts_findings(self):
        spec = importlib.util.spec_from_file_location('public_check', ROOT / 'tools/check_public.py')
        checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(checker)
        fabricated = 'ghp_' + 'x'*32
        findings = checker.check_text('example.py', fabricated)
        self.assertEqual(findings, ['example.py: github-token'])
        self.assertNotIn(fabricated, str(findings))

    def test_web_does_not_embed_external_assets(self):
        html = (ROOT / 'web/index.html').read_text()
        self.assertNotIn('https://', html)
        self.assertIn('SYNTHETIC DATA ONLY', html)


if __name__ == '__main__':
    unittest.main()
