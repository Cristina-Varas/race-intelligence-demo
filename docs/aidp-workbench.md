# AIDP Workbench execution guide

## Preconditions

Use an operator-approved Workbench notebook environment with Python 3.11+,
Spark/Delta, and a `spark` session. Runtime availability, catalog permissions,
volume mounts and object-storage backing depend on your deployment. An
administrator must provision a dedicated demo schema before execution.
This guide does not provision infrastructure or prescribe tenant-specific UI.

Clone this repository using your organization's approved Git workflow. Keep
tokens and storage authentication in platform-managed secrets or identities,
never in notebooks, Git URLs, screenshots or this repository.

Configure these **non-secret** runtime variables externally:

| Variable | Meaning |
| --- | --- |
| `AIDP_PROJECT_ROOT` | Absolute path to the checkout containing `race_demo/` |
| `RACE_DEMO_EXECUTION` | Explicitly `AIDP_WORKBENCH` |
| `AIDP_DEMO_SCHEMA` | Provisioned `schema` or `catalog.schema`; final name ends in `_demo` |
| `RACE_DEMO_OUTPUT` | New, dedicated writable path on a Python-accessible demo volume |

The schema name is validated before table operations. The pipeline never creates
schemas, drops tables, deletes artifacts, overwrites existing tables, or touches
any production session/archive path. Existing tables with different contents
cause a conflict. Use a new demo schema and output directory for changed data or
model settings. A concurrent first writer can cause `errorifexists`; retry only
after examining the run and then use the read-back/idempotency checks.

## Execution

Run `00`, `01`, `02`, `03`, `04`, then `99`. Each notebook independently imports
the same Python source from the checkout and reads the preceding persisted
layer. The notebooks remain portable when launched from the repository root or
`notebooks_aidp/`; elsewhere configure `AIDP_PROJECT_ROOT`.

Workbench creates these tables inside the configured demo schema:

```text
race_intelligence_bronze_v1
race_intelligence_silver_v1
race_intelligence_gold_profiles_v1
race_intelligence_gold_deviations_v1
race_intelligence_gold_scenarios_v1
race_intelligence_gold_curve_v1
```

Bronze and Silver contain 768 rows each; profiles contain 16 rows; deviations
contain 768 rows; scenarios contain 2 rows. Curve row counts depend on the
simulation grid. Every table is tagged with `SYNTHETIC_DEMO`. Read-back hashes
verify complete content, not only counts.

The serving artifact is `serving/demo.json` under the configured output path.
Transfer **only that generated synthetic artifact** using an approved download
workflow. The local server needs no cloud credentials to present it. Do not
commit your mounted paths, execution outputs or environment configuration.

## Local and cloud validation are different

With no execution environment variables set, notebooks run the offline JSON
pipeline and label it `LOCAL_DEMO`. That is useful for testing but does not prove
Delta or AIDP connectivity. Cloud validation requires running all notebooks in
Workbench, seeing `AIDP_WORKBENCH`, passing `99`, and repeating the sequence to
verify idempotency. Retain the source commit and run evidence privately.

The tiny dataset is deliberately collected into driver memory. These notebooks
demonstrate governed orchestration and publication, not scalable distributed
feature engineering. Spark supplies Delta storage; Python runs the simulation.

## Why a dedicated public pipeline?

The operational archive notebooks depend on private event evidence and source
contracts. They are not copied. This self-contained pipeline preserves the
Bronze/Silver/Gold discipline and reuses the original analytical calculation
core while making data generation, configuration and provenance safe to share.
