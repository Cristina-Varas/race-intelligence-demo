"""Environment-only configuration for the serving API."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
import tempfile


@dataclass(frozen=True)
class Settings:
    db_user: str | None
    db_password: str | None
    db_dsn: str | None
    wallet_location: str | None
    wallet_password: str | None
    event_journal_dir: Path = field(
        default_factory=lambda: Path(tempfile.gettempdir()) / "race-intelligence-event-capture"
    )

    @property
    def database_configured(self) -> bool:
        return bool(self.db_user and self.db_password and self.db_dsn)

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            db_user=os.getenv("RACE_DB_USER") or None,
            db_password=os.getenv("RACE_DB_PASSWORD") or None,
            db_dsn=os.getenv("RACE_DB_DSN") or None,
            wallet_location=os.getenv("RACE_DB_WALLET_LOCATION") or None,
            wallet_password=os.getenv("RACE_DB_WALLET_PASSWORD") or None,
            # The capture journal is deliberately outside the repository. It is
            # only a local recovery boundary until an AIDP Bronze write adapter
            # is configured.
            event_journal_dir=Path(
                os.getenv("RACE_EVENT_JOURNAL_DIR")
                or Path(tempfile.gettempdir()) / "race-intelligence-event-capture"
            ),
        )


@dataclass(frozen=True)
class AksSettings:
    """Environment configuration for the isolated AKS SSL/TCP integration."""

    host: str | None
    port: int = 11001
    user: str = ""
    password: str = ""
    app: str = "Race Intelligence"
    app_version: str = "0.1"
    protocol: str = "AKS V2 Protocol"
    protocol_version: str = "1.0.36"
    tls_verify: bool = True
    tls_enabled: bool = True
    ca_bundle: str | None = None
    subscriptions: tuple[str, ...] = ()
    stream_limit_bytes: int = 262_144

    @classmethod
    def from_env(cls) -> "AksSettings":
        verify = (os.getenv("AKS_TLS_VERIFY") or "true").strip().lower()
        tls_enabled = (os.getenv("AKS_TLS_ENABLED") or "true").strip().lower()
        if verify not in {"true", "false"}:
            raise ValueError("AKS_TLS_VERIFY must be true or false.")
        if tls_enabled not in {"true", "false"}:
            raise ValueError("AKS_TLS_ENABLED must be true or false.")
        port = int(os.getenv("AKS_PORT") or "11001")
        if not 1 <= port <= 65535:
            raise ValueError("AKS_PORT must be between 1 and 65535.")
        stream_limit_bytes = int(os.getenv("AKS_STREAM_LIMIT_BYTES") or "262144")
        if not 65_536 <= stream_limit_bytes <= 4_194_304:
            raise ValueError("AKS_STREAM_LIMIT_BYTES must be between 65536 and 4194304.")
        return cls(
            host=os.getenv("AKS_HOST") or None,
            port=port,
            user=os.getenv("AKS_USER") or os.getenv("AKS_USERNAME") or "",
            password=os.getenv("AKS_PASSWORD") or "",
            app=os.getenv("AKS_APP") or "Race Intelligence",
            app_version=os.getenv("AKS_APP_VERSION") or "0.1",
            protocol=os.getenv("AKS_PROTOCOL") or "AKS V2 Protocol",
            protocol_version=os.getenv("AKS_PROTOCOL_VERSION") or "1.0.36",
            tls_verify=verify == "true",
            tls_enabled=tls_enabled == "true",
            ca_bundle=os.getenv("AKS_CA_BUNDLE") or None,
            subscriptions=tuple(channel.strip() for channel in (os.getenv("AKS_SUBSCRIPTIONS") or "").split(",") if channel.strip()),
            stream_limit_bytes=stream_limit_bytes,
        )
