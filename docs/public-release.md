# Public release boundary

## Included by explicit allowlist

- Three extracted pure calculation modules and package initializers.
- New synthetic-only transforms, publication checks and local server.
- Six newly generated notebooks with no execution outputs.
- New standalone HTML/CSS/JavaScript presentation; no third-party assets/CDNs.
- Tests, notebook-generation tooling, content checks and documentation.
- Placeholder-only configuration and standard-library requirements notes.

## Excluded

Private Git history; all real data/results; source CSVs and PDFs; resources;
recordings; GPS; raw sessions; operational LIVE code; archive caches; secrets;
wallets; OCI configuration; private keys; database details; internal runbooks;
screenshots; generated build artifacts; names and photos of participants.

## Release checks

Run `python3 -B tools/check_public.py`, the test suite, `git diff --check` and
`git diff --cached --check`. Inspect the exact staged list before committing.
The content checker reports paths/rules, never matching secret text. It checks
for common credential formats, private host/path identifiers, populated notebook
outputs, unexpected files, symlinks and large artifacts. Pattern scanning is a
defence in depth, not a guarantee that every possible secret can be detected.

No original Git history is imported. Future additions need the same review;
`.gitignore` does not remove already tracked content or protect committed history.

## Ownership and licensing

The repository owner authorized preparing and publishing this public extraction.
No third-party logos or event data are included. This does not replace an
employer's publication approval or grant rights the owner does not hold. No
open-source license is selected on the owner's behalf. Review ownership and
choose a license separately before advertising the project as open source.

## Validation limits

Local automated checks cover calculations, synthetic provenance, artifact
conflicts, HTTP allowlists and notebook local execution. Mocked Spark tests check
publication control flow, not actual Spark/Delta compatibility. AIDP execution,
catalog authorization and managed storage require a real Workbench validation.
