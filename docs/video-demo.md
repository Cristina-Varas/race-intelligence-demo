# Video outline — AIDP first (approximately 5 minutes)

## Before recording

- Run the tests and note the public repository commit.
- For a cloud narrative, execute the notebooks in Workbench and pass `99` first.
  If that is not possible, explicitly call this a local demonstration of the
  AIDP-ready pipeline, not a completed cloud run.
- Record only approved windows. Hide account menus, browser profile, tenant
  identifiers, volume paths, terminal prompts, notifications and unrelated tabs.
- Use only generated data; do not open the original operational application.

## 0:00–0:40 / The question

“How can we turn data into an explainable racing scenario? This public demo uses
fictional participants so we can show the full analytical path safely.”

## 0:40–2:10 / AIDP data foundation

Show the architecture and notebook sequence. In a validated Workbench run, show
Bronze row count, Silver key/hash checks and Gold profiles. Explain that the
100-participant stress field does not enlarge the source evidence. Show the
scenario tables separately from profile tables.

## 2:10–3:00 / Reproducible modelling

Show the seed, fixed-lap assumptions, Monte Carlo curve, read-back verification
and `99` parity gate. State that compute is driver-local in this bounded example.
No claim of real-driver forecasting or physical-overtake prediction.

## 3:00–4:20 / Decisions in the dashboard

Load the approved serving JSON. Point to its execution label. Compare 16 and
100 synthetic participants, vary the starting delay, run the scenario, and show
the changed probability. Say that interactive what-if runs are local, while
their baseline inputs came from the published artifact. Open a modelled card
and download the scenario JSON.

## 4:20–5:00 / Close

“AIDP brings the data preparation, quality gates and reusable analytical outputs
into one Workbench workflow. The application is the visible result of that
pipeline. This repository reproduces the demonstration without exposing the
original event's data or LIVE integration.”

Finish on the public README and its precise limitations. Do not show secrets,
original event results, unapproved logos or footage implying official endorsement.
