"""Read-only python-oracledb access with a lazily created connection pool."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterator, Mapping, Sequence

from .config import Settings
from .shutdown import DATABASE_CONNECT_SECONDS, DATABASE_CALL_MILLISECONDS


def api_column_name(column: str) -> str:
    """Convert Oracle's unquoted UPPER_SNAKE_CASE columns to API camelCase."""
    if not column.isupper():
        return column
    head, *tail = column.lower().split("_")
    return head + "".join(part.title() for part in tail)


class Database:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._pool = None

    def _get_pool(self):
        if self._pool is None:
            if not self.settings.database_configured:
                raise RuntimeError("Database is not configured; set RACE_DB_USER, RACE_DB_PASSWORD, and RACE_DB_DSN.")
            try:
                import oracledb
            except ImportError as exc:
                raise RuntimeError("python-oracledb is required; install app/backend/requirements.txt.") from exc

            options: dict[str, Any] = {
                "user": self.settings.db_user,
                "password": self.settings.db_password,
                "dsn": self.settings.db_dsn,
                "min": 1,
                "max": 4,
                "increment": 1,
                # Do not allow serving connection retry policies to hold worker
                # threads for minutes while the LIVE recorder is shutting down.
                "tcp_connect_timeout": DATABASE_CONNECT_SECONDS,
                "retry_count": 0,
                "getmode": oracledb.POOL_GETMODE_TIMEDWAIT,
                "wait_timeout": DATABASE_CALL_MILLISECONDS,
            }
            if self.settings.wallet_location:
                options["config_dir"] = self.settings.wallet_location
                options["wallet_location"] = self.settings.wallet_location
            if self.settings.wallet_password:
                options["wallet_password"] = self.settings.wallet_password
            # DSN/TNS descriptors override keyword retry settings in thin mode.
            # Resolve the same configured service first, then apply our budgets.
            dsn = options.pop("dsn")
            params = oracledb.PoolParams(**options)
            params.parse_connect_string(dsn)
            params.set(tcp_connect_timeout=DATABASE_CONNECT_SECONDS, retry_count=0)
            self._pool = oracledb.create_pool(params=params)
        return self._pool

    @contextmanager
    def connection(self) -> Iterator[Any]:
        connection = self._get_pool().acquire()
        try:
            connection.call_timeout = DATABASE_CALL_MILLISECONDS
            yield connection
        finally:
            connection.close()

    def fetch_all(
        self,
        statement: str,
        parameters: Mapping[str, Any] | Sequence[Any] | None = None,
    ) -> list[dict[str, Any]]:
        with self.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(statement, parameters or None)
                columns = [api_column_name(column[0]) for column in cursor.description]
                return [dict(zip(columns, row)) for row in cursor.fetchall()]

    def ping(self) -> bool:
        self.fetch_all("SELECT 1 AS databaseReachable FROM dual")
        return True


def json_safe(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value
