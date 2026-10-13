import http.client
from http.server import ThreadingHTTPServer
import json
from threading import Thread
import unittest

from race_demo.pipeline import generate_bronze, build_silver, build_gold, serving_document
from race_demo.server import handler_for


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bronze = generate_bronze()
        silver = build_silver(bronze)
        document = serving_document(bronze, silver, build_gold(silver), simulations=100)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(document))
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.thread.join()
        cls.server.server_close()

    def request(self, method, path, payload=None, content_type='application/json'):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=20)
        body = None if payload is None else json.dumps(payload)
        connection.request(method, path, body, {'Content-Type':content_type})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_static_allowlist_and_security_headers(self):
        self.assertEqual(self.request('GET', '/favicon.ico')[0], 204)
        for path in ('/', '/app.js', '/styles.css'):
            status, headers, body = self.request('GET', path)
            self.assertEqual(status, 200)
            self.assertIn('Content-Security-Policy', headers)
            self.assertTrue(body)
        for path in ('/.env', '/../README.md', '/race_demo/pipeline.py', '/api/event/live-source'):
            self.assertEqual(self.request('GET', path)[0], 404)

    def test_baseline_is_explicitly_local_and_synthetic(self):
        status, _, body = self.request('GET', '/api/demo')
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(data['execution'], 'LOCAL_DEMO')
        self.assertEqual(data['evidence_type'], 'SYNTHETIC_DEMO')

    def test_custom_run_and_validation(self):
        status, _, body = self.request('POST', '/api/simulate', {'simulations':100,'field_size':100})
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(data['execution'], 'LOCAL_WHAT_IF')
        self.assertEqual(data['scenario']['field_size'], 100)
        self.assertEqual(self.request('POST', '/api/simulate', {'field_size':101})[0], 400)
        self.assertEqual(self.request('POST', '/api/simulate', {'path':'private'})[0], 400)
        self.assertEqual(self.request('POST', '/api/simulate', {}, 'text/plain')[0], 415)
        self.assertEqual(self.request('POST', '/api/event', {})[0], 404)


if __name__ == '__main__':
    unittest.main()
