"""Existing card endpoint cutover: no LIVE change, no direct AIDP browser query."""
from types import SimpleNamespace

import pytest

from app.services.baseball_card_data import build_serving_card_data, CARD_DATA_HEADERS


def row(**changes):
    return {"logicalSessionId": "S", "sourceEpoch": 2, "participantId": "AKS_21", "kartNumber": "21",
            "latestObservedPosition": 1, "peakObservedPosition": 1, "observedLap": 2,
            "gapToLeader": 0.0, "interval": .3, "bestValidLap": 95.0,
            "startPosition": None, "finalPosition": None, "positionChange": None,
            "updatedAt": "2026-09-14T00:00:00Z", "operationalContext": "ACTUAL_EVENT",
            "evidenceDomain": "FACTUAL_OBSERVATION", "eventContractVersion": "1.0", **changes}


def test_serving_preserves_contract_and_excludes_identity():
    def fetch(query, binds):
        assert "V_EVENT_BASEBALL_CARD_EVIDENCE" in query and "SELECT *" not in query
        assert binds == {"session_id": "S"}
        return [row(displayName="not-exposed", photoAsset="not-exposed")]
    result = build_serving_card_data("S", SimpleNamespace(fetch_all=fetch))
    card = result["rows"][0]
    assert result["metadata"]["sourceEpoch"] == 2
    assert (card["latestObservedPosition"], card["observedLap"], card["bestLapSeconds"]) == (1, 2, 95)
    assert all(key in card for key in CARD_DATA_HEADERS)
    assert card["Participant Name"] is None and card["Photo Asset"] is None
    assert card["Laps When Max Passed"] is None and card["Final Position"] is None
    assert "not-exposed" not in str(result)


@pytest.mark.parametrize("records", [[], [row(), row(sourceEpoch=1)], [row(evidenceDomain="MODELLED_SCENARIO")], [row(finalPosition=1)], [row(kartNumber="SC")]])
def test_invalid_or_missing_serving_evidence_never_falls_back(records):
    with pytest.raises((ValueError, FileNotFoundError)):
        build_serving_card_data("S", SimpleNamespace(fetch_all=lambda *args: records))


def test_configured_cutover_keeps_live_selection_first(monkeypatch):
    from app.routers.event import _baseball_source
    monkeypatch.setenv("EVENT_POST_SESSION_SOURCE", "aidp")
    sentinel = {"source": "LIVE"}
    cards = SimpleNamespace(sessions={"S": {}}, snapshot=lambda *args: sentinel)
    database = SimpleNamespace(fetch_all=lambda *args: [row()])
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
        live_baseball_cards=cards, live_source=SimpleNamespace(mode="live"), database=database)))
    assert _baseball_source(request, "S", "event", "auto") is sentinel
    assert _baseball_source(request, "S", "event", "replay")["metadata"]["sourceType"] == "AIDP_GOLD_EVENT"
