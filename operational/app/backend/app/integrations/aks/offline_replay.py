"""Deterministic no-network AKS replay: protocol line → state → normalizer → journal bridge."""
from __future__ import annotations

from .client import AksTimingClient
from .event_capture_bridge import AksBridgeResult, AksEventCaptureBridge
from .normalizer import AksStateNormalizer


class AksOfflineReplay:
    def __init__(self, client: AksTimingClient, normalizer: AksStateNormalizer, bridge: AksEventCaptureBridge):
        self.client, self.normalizer, self.bridge = client, normalizer, bridge

    def replay_lines(self, lines: list[str]) -> list[AksBridgeResult]:
        results = []
        for line in lines:
            self.client.handle_line(line)
            results.append(self.bridge.apply(self.normalizer.normalize(self.client.state_store)))
        return results
