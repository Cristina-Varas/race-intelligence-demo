# Existing Race Intelligence application and AIDP workflow

This directory holds a publication copy of the existing analytical application:
React frontend, FastAPI backend, reusable `src/` modules, selected tests, SQL
templates and the original AIDP notebooks `00`–`14` and `99`.

Notebook code is preserved except for portable checkout discovery in `00`–`09`.
Saved outputs, attachments and execution metadata were removed. SQL storage
identifiers were replaced with placeholders. Configuration examples contain no
credentials. Connection code is present but cannot authenticate from Git.

The Workbench workflow expects governed historical landing data and/or a
completed event archive, plus catalog, schemas, volumes and serving permissions.
These inputs remain outside Git. A fresh checkout contains the source, not the
original data or an Oracle environment.

This copy was prepared from the source tree available on 15 October 2026. A
previous separate `live-data-next` worktree was not available in that source
tree, so its later Silverstone dashboard/Builder changes are not asserted to be
present here. Check the source version shown in the video against this copy.

## AIDP notebook sequences

| Sequence | Purpose | Existing input |
| --- | --- | --- |
| `00`–`09` | Historical Bronze → Silver → Gold → scenario → serving | Governed historical landing data and catalog |
| `10`–`14`, `99` | Durable archive → Bronze → Silver/sourceEpoch → factual Gold → serving | Finalized, validated archive segment |

Set `AIDP_PROJECT_ROOT` to the absolute path of this `operational/` directory
in Workbench. The notebooks import `src/` and backend modules from this same
checkout. Follow [the Workbench guide](../docs/full-project-workbench.md)
before running mutation-capable cells.

The event replay notebooks `15`–`19` were excluded because that source set
contains event-specific replay packaging and evidence. Older research notebooks,
local data/outputs/resources, internal diagrams, recordings and logs were also
excluded. The implemented `10`–`14` path remains available for an archive that
is already present in an authorized Workbench volume.

## Application

The React source is under `app/frontend/`; FastAPI is under `app/backend/`.
Install declared dependencies in a separate environment. The backend expects
operator-provided serving configuration and, for replay, an authorized local
recording. Without those it reports an unavailable data source. The isolated
synthetic dashboard at the repository root needs neither dependency.

The original documentation images were unavailable for this public copy, so
the frontend displays a visible placeholder in those positions. Its logo is a
neutral Race Intelligence mark.

## Verification

Run the frontend build/tests from `app/frontend`. AIDP-specific Python tests
run with `PYTHONPATH=app/backend`. Actual cloud behavior still requires a
Workbench execution using the intended catalog and volumes.
