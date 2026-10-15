# Public checkpoint validation — 2026-10-15

## Verified locally

- 21 automated tests passed on Python 3.12; the initial suite also passed on
  Python 3.14 before the harmless favicon response adjustment.
- All six notebooks executed in `LOCAL_DEMO` twice, with fresh namespaces per
  notebook, complete parity validation and idempotent artifact writes.
- 16/100-participant calculations are reproducible; probabilities stay bounded
  and the shared-draw delay curve is monotonic.
- Malformed input, a modified synthetic dataset, duplicate keys and artifact
  conflicts fail closed.
- HTTP allowlists reject arbitrary file access and operational LIVE routes.
- Isolated Chrome: baseline, 100-participant scenario, participant-card selection
  and actual JSON download passed. No current browser errors. Desktop and
  390-pixel mobile layouts had no horizontal page overflow.
- The three retained calculation modules match the source extraction apart
  from display-label substitutions. No private data were used as test fixtures.
- Public-content pattern scan and whitespace checks passed before publication.
- The copied operational frontend built successfully; its 184 automated tests
  passed. A neutral logo replaces the unavailable original asset.
- 16 copied operational AIDP notebooks parsed successfully and have no saved
  execution outputs. Their source import paths resolve inside `operational/`.
- The selected operational Python suite passed 84 tests in a temporary Python
  3.12 environment with the declared dependencies.

## Not verified / not claimed

- No Oracle account, Workbench execution, Delta runtime, catalog permission,
  OCI storage integration or Autonomous serving connection was used in this
  validation.
- Mocked Spark tests cover control flow and conflict handling only.
- No real-event performance, forecast accuracy or production readiness claim.
- Secret-pattern checks are not an exhaustive information-security audit.
- Event-specific replay notebooks 15–19, real data, KML/geometries and original
  documentation diagrams are absent. Tests that require those omitted assets
  or older notebook versions were excluded from this public copy.
- The separate `live-data-next` worktree was unavailable when this source
  snapshot was prepared; the copy does not claim to contain its later changes.
- No open-source licensing or employer publication approval is inferred by
  these technical checks.

For cloud evidence, execute the full notebook sequence in the intended AIDP
runtime and retain the source commit, run identity and validation result using
the organization's approved evidence process. Keep private run metadata out of
the public repository and video.
