# Race Intelligence — an AIDP demonstration

**Turn a reproducible data foundation into explainable racing scenarios with
Oracle AI Data Platform (AIDP).**

This repository has two clearly labelled experiences. The root-level demo is
an isolated synthetic example. [`operational/`](operational/README.md) preserves
the larger application's source and the existing AIDP notebook workflow for
execution in an authorized Workbench environment. This workflow requires its
governed inputs and configured platform resources.

**No real participant data, recordings, GPS samples, credentials, private
infrastructure identifiers or original Git history are included.** The
operational source includes connection modules but no production configuration
or data. The root demo's data are generated from code.

## AIDP is the analytical backbone

```text
Generated synthetic laps
         │
         ▼
AIDP Workbench · operator-configured Spark/Delta runtime
  Bronze: reproducible source records
    → Silver: canonical keys and fail-closed quality checks
    → Gold: reusable pace profiles and variability
    → Scenario Gold: deterministic analysis + seeded Monte Carlo
         │
         ▼
Verified JSON serving projection → Race Intelligence dashboard
```

For the root-level synthetic path, Workbench runs shared Python transformations
and publishes six demo Delta tables. Lakehouse storage, catalog/schema
permissions and any OCI Object Storage backing are provisioned by the operator.
This small example does not implement direct Object Storage upload, Autonomous
Database serving, streaming or distributed simulation. The larger operational
source contains separate archive and serving code.

The value demonstrated is a repeatable path from source to decisions: quality
checks, separate evidence and scenario layers, deterministic seeds, content
hashes, read-back verification, conflict detection and reusable serving outputs.
These checks complement—not replace—platform access control and governance.

For a video showing the existing AIDP workflow, use
[`operational/notebooks_aidp`](operational/notebooks_aidp/) and
[the Workbench instructions](docs/full-project-workbench.md). Those notebooks
retain the established Bronze, Silver, Gold and serving logic. The six
root-level notebooks form a separate synthetic example.

## Run locally

Requires Python **3.11 or newer**. No database, cloud account, package install,
Node build, API keys or external browser assets are needed.

```bash
git clone https://github.com/Cristina-Varas/race-intelligence-demo.git
cd race-intelligence-demo
python3 -B -m race_demo.server
```

Open **http://127.0.0.1:8090**. The interface explicitly displays `LOCAL_DEMO`.
The server binds only to loopback and is intended for local demonstrations,
not internet hosting. It does not use or restart the operational app's ports.

Explore a 16-participant synthetic reference, switch to a 100-participant
bootstrap stress test, change starting delay/pace advantage, inspect Monte Carlo
probabilities and modelled participant cards, then download the scenario JSON.
The public card is a reduced scenario preview, not the event's 24-column export.

### Execute only the pipeline

```bash
python3 -B -m race_demo.pipeline --output build/demo
python3 -B -m unittest discover -s tests -v
python3 -B tools/check_public.py
```

Artifacts are generated under ignored `build/`. Identical runs reuse identical
bytes. Different contents fail rather than overwrite: choose a new output
directory for a different configuration.

## Run in AIDP Workbench

Follow [the Workbench guide](docs/aidp-workbench.md), then execute these notebooks:

| Notebook | Purpose |
| --- | --- |
| `00_environment` | Import paths, explicit execution mode and safe destination |
| `01_bronze` | Generate and publish the synthetic source |
| `02_silver` | Validate the exact source dataset and canonical lap keys |
| `03_gold` | Publish synthetic profiles and lap variability |
| `04_simulate_publish` | Calculate scenarios; publish summaries, curves and serving JSON |
| `99_validation` | Recompute serving parity and verify all six Delta tables |

**Release status:** the local pipeline and notebook local path are testable here.
The AIDP-specific path must be validated in your configured Workbench runtime;
this public release does not claim that cloud execution has already passed.

To show an artifact exported by Workbench:

```bash
python3 -B -m race_demo.server --serving-file /path/to/approved-demo.json
```

The server recomputes parity before serving it. A valid Workbench artifact shows
`AIDP_WORKBENCH`; custom interactive runs show `LOCAL_WHAT_IF`, retaining the
input provenance. The execution label is recorded by the notebook and is **not
cryptographic proof of platform execution**. Retain Workbench run evidence
privately if you need an auditable cloud-execution claim.

## Understand the model

- 768 generated laps: 2 fictional sessions × 16 participants × 24 laps.
- Nominal pace: participant median; variability: within-session deviations.
- Virtual Challenger pace: fastest reference pace minus an assumed advantage.
- Deterministic delay limit: race laps × the smallest nominal pace advantage.
- Monte Carlo: independent centered bootstrap lap deviations, deterministic
  Challenger pace, shared random draws across delay candidates, seed 42.
- The probability is the proportion of runs whose **terminal cumulative timing
  margin** meets the selected delay for every participant. It is not a model of
  physical passing or a validated real-race forecast.
- The 100-participant field is synthetic stress testing, not more evidence.

See [methodology and limitations](docs/methodology.md).

## Repository map

```text
notebooks_aidp/  Standalone synthetic Workbench narrative
operational/     Existing application and AIDP source, cleaned for publication
race_demo/      Shared transformations, retained calculation engine, local server
web/            Standalone, synthetic-only presentation
tests/          Reproducibility, model, notebook and safety checks
tools/          Notebook generation and public-content checks
docs/           Architecture, Workbench guide, video outline, release boundaries
```

## Present and publish responsibly

Use [the video outline](docs/video-demo.md) and
[the public-release checklist](docs/public-release.md).
No logo, real pilot identity, event result or third-party endorsement is implied.
Oracle and AIDP product references describe the intended platform integration.
No open-source license grant is included in this initial publication; the
repository owner must choose an appropriate license after reviewing ownership
and redistribution permissions. Public visibility is not a license grant.
