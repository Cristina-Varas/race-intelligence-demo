"""Loopback-only demo server. Not an internet-facing production service."""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Lock

from .pipeline import build, build_gold, build_silver, canonical, generate_bronze, serving_document, simulate

WEB = Path(__file__).resolve().parent.parent / "web"
FILES = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"),
         "/styles.css": ("styles.css", "text/css")}


def validate_serving(document):
    """Check the shared public dataset, provenance and recomputed scenarios."""
    bronze = generate_bronze()
    silver = build_silver(bronze)
    gold = build_gold(silver)
    simulations = document["scenarios"]["16"]["simulations"]
    expected = serving_document(bronze, silver, gold, execution=document["execution"], simulations=simulations)
    if canonical(document) != canonical(expected):
        raise ValueError("Serving artifact fails parity validation.")
    return document


def handler_for(document):
    calculation = Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, body, content_type="application/json"):
            payload = body if isinstance(body, bytes) else canonical(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type + "; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.path == "/favicon.ico":
                return self.reply(204, b"", "image/x-icon")
            if self.path == "/api/demo":
                return self.reply(200, document)
            if self.path in FILES:
                name, content_type = FILES[self.path]
                return self.reply(200, (WEB / name).read_bytes(), content_type)
            self.reply(404, {"error": "Not found"})

        def do_POST(self):
            if self.path != "/api/simulate":
                return self.reply(404, {"error": "Not found"})
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                return self.reply(415, {"error": "JSON required"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 1 <= length <= 2048:
                    raise ValueError("Request size not allowed")
                self.connection.settimeout(5)
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict) or set(payload) - {"field_size", "race_laps", "advantage", "delay", "simulations"}:
                    raise ValueError("Unsupported scenario parameters")
            except (ValueError, TimeoutError):
                return self.reply(400, {"error": "Invalid request"})
            if not calculation.acquire(blocking=False):
                return self.reply(429, {"error": "A scenario is already running"})
            try:
                result = simulate(document["gold"], **payload)
                self.reply(200, {"scenario": result, "execution": "LOCAL_WHAT_IF",
                                 "input_execution": document["execution"]})
            except (TypeError, ValueError) as exc:
                self.reply(400, {"error": str(exc)})
            finally:
                calculation.release()

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--serving-file", type=Path)
    args = parser.parse_args()
    document = validate_serving(json.loads(args.serving_file.read_text())) if args.serving_file else build(Path("build/demo"))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(document))
    print(f"Race Intelligence demo: http://127.0.0.1:{args.port} — {document['execution']}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
