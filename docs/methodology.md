# Methodology and interpretation

## What is retained from the original application?

Three pure Python modules were extracted from the analytical backend:

- `simulation.py`: bounded synthetic-field generation, deterministic timing
  calculations and seeded Monte Carlo.
- `field_variability.py`: bootstrap and timing helpers.
- `race_assumptions.py`: shared race progression calculation helpers.

They live under `race_demo/engine/`. Human-readable references to a named pilot
were changed to “Virtual Challenger”; legacy internal parameter names remain
for compatibility. No source event data are copied. The public wrapper restricts
execution to fixed-lap, pure-timing scenarios and exposes an explicitly synthetic
response. Other retained engine branches are not public demo capabilities.

The original operational UI, cloud configuration, capture services, and private
notebooks are not copied. The public dashboard and clean notebooks are new
presentation/orchestration layers around the retained engine.

## Input and transformation

Seed `20261013` generates a fictional nominal pace ladder plus uniform lap
variation. The dataset is not fitted to a person, track or event. Silver requires
the exact generated content hash as well as valid schema and unique keys. Gold
computes median pace by participant and lap deviations around session medians.

For the 100-participant field, the engine bootstraps the 16 synthetic profiles,
applies a normally sampled shift with scale 10% of the between-profile median
absolute deviation, clips the shift to 25% of that deviation, and clips pace to
the source range. Seed 42 controls this illustrative stress population.

## Probability definition

For each Monte Carlo run, each field participant independently samples centered
lap deviations from the synthetic pool. Virtual Challenger pace is deterministic.
At race distance L, compute each participant's cumulative time minus the
Challenger's L-lap time. The minimum across participants is the full-field timing
margin. A run succeeds when this margin is at least the chosen starting delay.

The same sampled paths evaluate every delay, yielding a non-increasing curve.
P50/P80/P90 are maximum delays on a 0.1-second grid meeting their probability
threshold—not confidence intervals. Repeating seeded draws gives reproducible
scenarios; it does not establish real-world model accuracy.

Terminal margin is not “ever caught earlier in the race” when lap variability
can cause crossings and recrossings. Deterministic catch-lap cards use nominal
constant pace and are distinct from the Monte Carlo probability. A timing catch
is never asserted to be a physical pass.

## Limits

No real performance calibration, backtest, traffic/defence/pit model, GPS,
physical overtaking, tyre/fuel/weather effect, or official classification is
provided. Positive pace advantage, 0–30 s delay, 1–60 laps, 16/100 field size and
100–5,000 runs bound the public API. The UI uses 1,000 runs to keep demos quick.

## Card boundary

Cards contain synthetic ID, nominal pace, deterministic catch lap and simulated
catch probability. Unknown event fields are not invented. This is not the
operational Baseball Card Builder, its 24-column contract or its finalizer.
