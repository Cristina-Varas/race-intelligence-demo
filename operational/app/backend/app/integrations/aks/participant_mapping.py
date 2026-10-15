"""Explicit, auditable AKS participant identity mappings.

The mapping is deliberately file-based and optional. Raw AKS capture remains
independent of it; without approval, the normalizer uses a source-safe
``AKS_<external number>`` identity and ``UNCLASSIFIED`` participant type.
"""
from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from ...config import AksSettings
from .client import AksTimingClient
from .normalizer import AksIdentityMapper, AksParticipantIdentity, AksStateNormalizer
from .recording import AksPlaybackMode, AksRecordingLoader, AksRecordingReplay


PARTICIPANT_TYPES = {"MAX", "CHALLENGER", "ORACLE_DRIVER", "UNCLASSIFIED"}
SPECIAL_ROLES = {"VIRTUAL_MAX", "REHEARSAL_REFERENCE"}
MAPPING_FIELDS = (
    "external_participant_number", "participant_id", "display_name", "kart_id",
    "participant_type", "special_role", "mapping_source", "approved",
    "source_display_name", "source_kart_or_vehicle", "source_team", "source_driver_id",
)


class ParticipantMappingError(ValueError):
    pass


@dataclass(frozen=True)
class ParticipantMapping:
    external_participant_number: str
    participant_id: str | None = None
    display_name: str | None = None
    kart_id: str | None = None
    participant_type: str | None = None
    special_role: str | None = None
    mapping_source: str | None = None
    approved: bool = False

    @property
    def state(self) -> str:
        return "APPROVED" if self.approved else "SOURCE_ONLY"


@dataclass(frozen=True)
class MappingValidation:
    errors: tuple[str, ...]
    warnings: tuple[str, ...]

    @property
    def valid(self) -> bool:
        return not self.errors


def _text(value: object) -> str | None:
    value = str(value).strip() if value is not None else ""
    return value or None


def _truth(value: object) -> bool:
    value = str(value or "").strip().lower()
    if value in {"", "false", "0", "no"}:
        return False
    if value in {"true", "1", "yes"}:
        return True
    raise ParticipantMappingError("approved must be true or false.")


def load_mapping(path: str | Path) -> list[ParticipantMapping]:
    """Read the operator-controlled CSV without interpreting source metadata."""
    try:
        with Path(path).open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames is None or "external_participant_number" not in reader.fieldnames:
                raise ParticipantMappingError("Mapping CSV requires external_participant_number.")
            mappings = [ParticipantMapping(
                external_participant_number=_text(row.get("external_participant_number")) or "",
                participant_id=_text(row.get("participant_id")), display_name=_text(row.get("display_name")),
                kart_id=_text(row.get("kart_id")), participant_type=(_text(row.get("participant_type")) or "").upper() or None,
                special_role=(_text(row.get("special_role")) or "").upper() or None,
                mapping_source=_text(row.get("mapping_source")), approved=_truth(row.get("approved")),
            ) for row in reader]
    except OSError as exc:
        raise ParticipantMappingError(f"Unable to read participant mapping: {exc}") from exc
    return mappings


def validate_mapping(mappings: Iterable[ParticipantMapping], *, discovered_numbers: Iterable[str] | None = None) -> MappingValidation:
    errors: list[str] = []
    warnings: list[str] = []
    external_seen: set[str] = set()
    participant_seen: set[str] = set()
    known_numbers = set(str(number) for number in discovered_numbers) if discovered_numbers is not None else None
    for mapping in mappings:
        number = mapping.external_participant_number
        if not number:
            errors.append("Mapping has a blank external_participant_number.")
            continue
        if number in external_seen:
            errors.append(f"Duplicate external participant number: {number}.")
        external_seen.add(number)
        if known_numbers is not None and number not in known_numbers:
            errors.append(f"Mapping participant {number} is not present in this AKS session.")
        if mapping.participant_type and mapping.participant_type not in PARTICIPANT_TYPES:
            errors.append(f"Mapping participant {number} has invalid participant_type {mapping.participant_type!r}.")
        if mapping.special_role and mapping.special_role not in SPECIAL_ROLES:
            errors.append(f"Mapping participant {number} has unknown special_role {mapping.special_role!r}.")
        if mapping.approved:
            required = {
                "participant_id": mapping.participant_id,
                "participant_type": mapping.participant_type,
                "mapping_source": mapping.mapping_source,
            }
            missing = [field for field, value in required.items() if not value]
            if missing:
                errors.append(f"Approved mapping participant {number} is missing: {', '.join(missing)}.")
            if mapping.participant_id:
                if mapping.participant_id in participant_seen:
                    errors.append(f"Duplicate internal participant_id: {mapping.participant_id}.")
                participant_seen.add(mapping.participant_id)
        elif any((mapping.participant_id, mapping.display_name, mapping.kart_id, mapping.special_role)) or mapping.participant_type not in {None, "UNCLASSIFIED"}:
            warnings.append(f"Mapping participant {number} is not approved; identity fields are not promoted.")
    return MappingValidation(tuple(errors), tuple(warnings))


def identity_mapper(mappings: Iterable[ParticipantMapping]) -> AksIdentityMapper:
    """Use only explicitly approved identity assertions in the live/replay mapper."""
    approved = {
        mapping.external_participant_number: AksParticipantIdentity(
            participant_id=mapping.participant_id,
            participant_type=mapping.participant_type,
            special_role=mapping.special_role,
            display_name=mapping.display_name,
            kart_id=mapping.kart_id,
        )
        for mapping in mappings if mapping.approved
    }
    return AksIdentityMapper(approved)


def discover_recording(recording: str | Path, *, mapper: AksIdentityMapper | None = None):
    replay = AksRecordingReplay(
        AksRecordingLoader(recording), AksTimingClient(AksSettings(host="offline")), AksStateNormalizer(mapper), None,
    )
    _, normalized, _ = replay.replay(mode=AksPlaybackMode.AS_FAST_AS_POSSIBLE)
    if normalized is None:
        raise ParticipantMappingError("AKS recording produced no normalized state.")
    return normalized


def write_template(recording: str | Path, output: str | Path) -> tuple[Path, int]:
    """Create a local source-metadata review template; it asserts no identities."""
    normalized = discover_recording(recording)
    rows = []
    for participant in sorted(normalized.participants, key=lambda item: int(item.external_participant_number) if item.external_participant_number.isdigit() else item.external_participant_number):
        metadata = participant.metadata
        rows.append({
            "external_participant_number": participant.external_participant_number,
            "participant_id": "", "display_name": "", "kart_id": "", "participant_type": "UNCLASSIFIED",
            "special_role": "", "mapping_source": "AKS_REHEARSAL_REVIEW", "approved": "false",
            "source_display_name": metadata.get("source_display_name") or "",
            "source_kart_or_vehicle": metadata.get("vehicle") or "",
            "source_team": metadata.get("team") or "",
            "source_driver_id": metadata.get("driver_id") or "",
        })
    destination = Path(output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=MAPPING_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    return destination, len(rows)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Safe AKS participant identity mapping workflow")
    sub = parser.add_subparsers(dest="command", required=True)
    template = sub.add_parser("template", help="Generate a source-metadata-only mapping template")
    template.add_argument("--recording", required=True)
    template.add_argument("--output", required=True)
    validate = sub.add_parser("validate", help="Validate a mapping against participants discovered in an AKS recording")
    validate.add_argument("--recording", required=True)
    validate.add_argument("--mapping", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "template":
        path, count = write_template(args.recording, args.output)
        print(f"Mapping template: {path} ({count} discovered AKS participants)")
        return 0
    mappings = load_mapping(args.mapping)
    discovered = discover_recording(args.recording)
    result = validate_mapping(mappings, discovered_numbers=[item.external_participant_number for item in discovered.participants])
    for warning in result.warnings:
        print(f"WARNING: {warning}")
    for error in result.errors:
        print(f"ERROR: {error}")
    print("Mapping validation: PASS" if result.valid else "Mapping validation: FAIL")
    return 0 if result.valid else 2


if __name__ == "__main__":
    raise SystemExit(main())
