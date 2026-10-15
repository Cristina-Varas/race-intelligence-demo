"""Operational entrypoint: stop durable LIVE intake before ASGI request drain.

Run from app/backend: python -m app.server --host 127.0.0.1 --port 8003 --env-file .env
The generic uvicorn CLI cannot prioritize our recorder before its request drain.
"""
import argparse
import asyncio
import logging

import uvicorn

from .shutdown import REQUEST_DRAIN_SECONDS


class OperationalServer(uvicorn.Server):
    async def shutdown(self, sockets=None):
        # Uvicorn wraps the application; use the original app explicitly.
        app = self.config.app
        app.state.shutting_down = True
        source = app.state.live_source
        for server in self.servers:
            server.close()
        if sockets:
            for sock in sockets: sock.close()
        # Crucially, do not wait for Oracle worker threads or browsers here.
        await source.close()
        for connection in list(self.server_state.connections):
            connection.shutdown()
        pending = set(self.server_state.tasks)
        if pending:
            _, pending = await asyncio.wait(pending, timeout=REQUEST_DRAIN_SECONDS)
            if pending:
                logging.getLogger("uvicorn.error").warning("SHUTDOWN_AUXILIARY_CANCELLED count=%d", len(pending))
                for task in pending: task.cancel()
                await asyncio.wait(pending, timeout=REQUEST_DRAIN_SECONDS)
        await self.lifespan.shutdown()
        source.stage("APP_SHUTDOWN_COMPLETE")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8003, type=int)
    parser.add_argument("--env-file", default=".env")
    args = parser.parse_args()
    # Load environment before importing the app (same dotenv precedence as Uvicorn).
    from dotenv import load_dotenv
    load_dotenv(args.env_file)
    from .main import app
    try:
        OperationalServer(uvicorn.Config(app, host=args.host, port=args.port,
            timeout_graceful_shutdown=REQUEST_DRAIN_SECONDS)).run()
    except KeyboardInterrupt:
        # Uvicorn re-raises the captured SIGINT after successful teardown.
        # Match its CLI behavior without a misleading interpreter traceback.
        pass


if __name__ == "__main__":
    main()
