# Run the existing project in AIDP Workbench

The public [`operational/`](../operational/) directory preserves the project's
existing AIDP transformations and application source. Choose its notebooks
for a video about the existing application. Root-level notebooks are an
independent synthetic example.

## Prepare the checkout

1. Clone this public repository using your organization's approved method.
2. Set `AIDP_PROJECT_ROOT` to the absolute path of `operational/` in that
   checkout. Notebooks `00`–`09` search it first; `10`–`14` and `99` use it too.
3. Review `operational/config/settings.yaml` against the catalog and volume
   names in your authorized Workbench environment. Keep environment-specific
   overrides and credentials outside Git.
4. Confirm the historical landing artifacts or completed durable archive
   exist before running notebook cells that write tables.

The checkout does not provision a catalog, upload data, create credentials or
bypass quality gates. Existing AIDP tables need not be recreated merely because
the source is in a new Git repository. Validate that Workbench reads this exact
checkout and that resource paths still match its configuration.

## Historical sequence

Run `00_environment_check` through `09_publish_serving_layer` in order. They
reuse `src/aidp_pipeline.py` and the established Bronze/Silver/Gold/serving
destinations. This sequence requires governed historical landing Parquet inputs.
Review each preflight report and target before any write.

## Durable event sequence

Use `10_event_capture_foundation` for shared contracts and preflight, followed
by `11_event_capture_rehearsal`, `12_event_capture_silver`,
`13_event_capture_gold`, `14_publish_event_serving` and `99_aidp_validation`.
A completed, integrity-validated archive segment must already be in the
configured volume. Silver migration is guarded and non-destructive; serving
publication has its own preflight gates.

The copied SQL files are templates. Storage host, namespace and bucket are
placeholders. Substitute approved values privately in Database Actions or in
a private deployment artifact; do not commit populated SQL.

## Application and video

The frontend expects FastAPI. Historical/scenario endpoints expect approved
serving views. A Workbench run alone does not make data available in the app:
validate the Parquet projection, serving objects and backend connection in
your environment. The LIVE path is a separate operational concern.

For the video, show the Git commit, a real Workbench run and its validation
result, then the dashboard consuming approved serving results. Keep tenant
identifiers, object paths, credentials, participant data and account details
out of the recording. A local run should be labelled local.

## Validation status

All included notebooks parse as Python and have no saved outputs. The frontend
builds and its automated suite passes. The AIDP cloud sequence has not been
executed from this public checkout; its first Workbench run is the parity gate
for the video.
