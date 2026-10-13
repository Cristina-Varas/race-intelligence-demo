"""Rebuild output-free public notebooks; no private notebook is an input."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = '''from pathlib import Path
import json, os, sys
root_hint = os.environ.get("AIDP_PROJECT_ROOT")
if root_hint:
    root = Path(root_hint).resolve()
else:
    root = next((p for p in [Path.cwd(), *Path.cwd().parents] if (p / "race_demo/pipeline.py").is_file()), None)
if root is None or not (root / "race_demo/pipeline.py").is_file():
    raise RuntimeError("Set AIDP_PROJECT_ROOT to this repository checkout.")
sys.path.insert(0, str(root))
from race_demo.pipeline import generate_bronze, build_silver, build_gold, serving_document, write_once, digest
from race_demo.workbench import publish_table, table_name
execution = os.environ.get("RACE_DEMO_EXECUTION", "LOCAL_DEMO")
if execution not in {"LOCAL_DEMO", "AIDP_WORKBENCH"}:
    raise ValueError("Unknown execution mode")
if execution == "AIDP_WORKBENCH":
    if "spark" not in globals():
        raise RuntimeError("Use an AIDP notebook runtime with Spark/Delta configured.")
    table_name("bronze")  # Validate the dedicated demo namespace before writes.
    if not os.environ.get("RACE_DEMO_OUTPUT"):
        raise RuntimeError("Set RACE_DEMO_OUTPUT to a new writable demo volume directory.")
output = Path(os.environ.get("RACE_DEMO_OUTPUT", str(root / "build/notebooks")))
print("Execution:", execution, "| Evidence: SYNTHETIC_DEMO")
'''

NOTEBOOKS = [
    ("00_environment", "Environment and publication boundary", """Start here. AIDP is the governed execution path; LOCAL_DEMO is an explicit offline alternative, not evidence of a Workbench run. Configure a dedicated demo schema and output volume externally. No credentials belong in a cell. No real event inputs are accepted. See docs/aidp-workbench.md.
""", '''print("Python modules imported. No tables created by this notebook.")
print("Expected: 768 generated laps, 16 synthetic profiles, 16/100 scenario populations.")
'''),
    ("01_bronze", "Bronze — reproducible synthetic source", """Generate two fictional sessions with 16 participants and 24 laps each. Bronze preserves the generated records. In Workbench, publish a Delta table in the demo schema and verify it by read-back. Identical reruns succeed; conflicts fail without overwriting.
""", '''bronze = generate_bronze()
write_once(output / "bronze/laps.json", bronze)
if execution == "AIDP_WORKBENCH":
    print(publish_table(spark, "bronze", bronze))
print({"rows": len(bronze), "sha256": digest(bronze)})
'''),
    ("02_silver", "Silver — quality and canonical keys", """Enforce the public schema, exact synthetic dataset hash, finite timings, unique session/participant/lap keys and complete population. No invalid record is silently dropped. In Workbench, read the preceding Delta layer, not a hidden local source.
""", '''bronze = ([r.asDict() for r in spark.table(table_name("bronze")).collect()]
          if execution == "AIDP_WORKBENCH" else json.loads((output / "bronze/laps.json").read_text()))
silver = build_silver(bronze)
write_once(output / "silver/laps.json", silver)
if execution == "AIDP_WORKBENCH":
    print(publish_table(spark, "silver", silver))
print({"rows": len(silver), "unique_keys": len({(r["session_id"], r["driver_id"], r["lap"]) for r in silver})})
'''),
    ("03_gold", "Gold — reusable profiles and variability", """Derive median nominal pace by synthetic participant and deviations around each session/participant median. Gold profiles remain separate from downstream scenario populations: a simulated 100-driver field never increases the input sample size.
""", '''silver = ([r.asDict() for r in spark.table(table_name("silver")).collect()]
          if execution == "AIDP_WORKBENCH" else json.loads((output / "silver/laps.json").read_text()))
gold = build_gold(silver)
write_once(output / "gold/profiles.json", gold)
if execution == "AIDP_WORKBENCH":
    print(publish_table(spark, "gold_profiles", gold["profiles"]))
    print(publish_table(spark, "gold_deviations", [{"sample_index": i, "deviation_seconds": d, "evidence_type": "SYNTHETIC_DEMO"} for i, d in enumerate(gold["deviations"])]))
print({"profiles": len(gold["profiles"]), "deviations": len(gold["deviations"]), "sha256": digest(gold)})
'''),
    ("04_simulate_publish", "Scenario Gold — Monte Carlo and serving", """Run the retained calculation engine on Gold inputs. Publish scenario summaries and probability curves separately from source profiles. The JSON serving projection drives the public dashboard without granting it database credentials. This small demo collects bounded data to the notebook driver; it is not distributed Monte Carlo.
""", '''bronze = generate_bronze()
silver = build_silver(bronze)
if execution == "AIDP_WORKBENCH":
    profiles = [r.asDict() for r in spark.table(table_name("gold_profiles")).orderBy("driver_id").collect()]
    deviations = [r["deviation_seconds"] for r in spark.table(table_name("gold_deviations")).orderBy("sample_index").collect()]
    gold = {"profiles": profiles, "deviations": deviations}
else:
    gold = json.loads((output / "gold/profiles.json").read_text())
document = serving_document(bronze, silver, gold, execution=execution)
if execution == "AIDP_WORKBENCH":
    summaries = [{"field_size": s["field_size"], "simulations": s["simulations"], "probability": s["full_field_probability"], "seed": s["simulation_seed"], "evidence_type": "SYNTHETIC_DEMO"} for s in document["scenarios"].values()]
    curves = [{"field_size": s["field_size"], "delay_seconds": p["delaySeconds"], "probability": p["catchProbability"], "evidence_type": "SYNTHETIC_DEMO"} for s in document["scenarios"].values() for p in s["curve"]]
    print(publish_table(spark, "gold_scenarios", summaries))
    print(publish_table(spark, "gold_curve", curves))
write_once(output / "serving/demo.json", document)
print({"execution": execution, "serving_sha256": digest(document), "status": "READ_BACK_VERIFIED"})
'''),
    ("99_validation", "Validation gate — parity, provenance and reproducibility", """Recompute and compare the complete serving artifact. Check all six Delta tables against the expected synthetic pipeline when running in Workbench. Do not describe a local pass as a cloud validation. Keep notebook execution outputs out of Git.
""", '''from race_demo.server import validate_serving
document = json.loads((output / "serving/demo.json").read_text())
if document["execution"] != execution:
    raise ValueError("Serving artifact comes from another execution mode")
validate_serving(document)
if execution == "AIDP_WORKBENCH":
    bronze = generate_bronze()
    silver = build_silver(bronze)
    gold = build_gold(silver)
    expected = {
        "bronze": bronze, "silver": silver, "gold_profiles": gold["profiles"],
        "gold_deviations": [{"sample_index": i, "deviation_seconds": d, "evidence_type": "SYNTHETIC_DEMO"} for i, d in enumerate(gold["deviations"])],
        "gold_scenarios": [{"field_size": s["field_size"], "simulations": s["simulations"], "probability": s["full_field_probability"], "seed": s["simulation_seed"], "evidence_type": "SYNTHETIC_DEMO"} for s in document["scenarios"].values()],
        "gold_curve": [{"field_size": s["field_size"], "delay_seconds": p["delaySeconds"], "probability": p["catchProbability"], "evidence_type": "SYNTHETIC_DEMO"} for s in document["scenarios"].values() for p in s["curve"]],
    }
    for layer, rows in expected.items():
        actual = [r.asDict() for r in spark.table(table_name(layer)).collect()]
        from race_demo.pipeline import canonical
        if digest(sorted(actual, key=canonical)) != digest(sorted(rows, key=canonical)):
            raise ValueError("Delta parity failed: " + layer)
print({"validation": "PASS", "execution": execution, "evidence_type": document["evidence_type"]})
'''),
]


def main():
    destination = ROOT / "notebooks_aidp"
    destination.mkdir(exist_ok=True)
    for name, title, description, code in NOTEBOOKS:
        cells = [
            {"cell_type": "markdown", "metadata": {}, "source": [f"# {title}\n\n", description]},
            *[{"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": text.splitlines(keepends=True)} for text in (BOOTSTRAP, code)],
        ]
        notebook = {"cells": cells, "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}, "language_info": {"name": "python", "version": "3.11"}}, "nbformat": 4, "nbformat_minor": 4}
        (destination / f"{name}.ipynb").write_text(json.dumps(notebook, indent=2) + "\n")


if __name__ == "__main__":
    main()
