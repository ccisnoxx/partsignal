"""核对实际捕获的 PG 查询计划，不重跑基准或改写业务数据。"""

import json
from pathlib import Path


def walk(node):
    yield node
    for child in node.get("Plans", []):
        yield from walk(child)


evidence = Path(__file__).resolve().parent
plans = json.loads((evidence / "final-capacity/capacity-plans.json").read_text())
page = next(
    plan for plan in plans["runs_deep"]
    if any(node["Node Type"] == "Limit" and node["Plan Width"] == 24
           for node in walk(plan["Plan"]))
)
nodes = list(walk(page["Plan"]))
limit = next(node for node in nodes
             if node["Node Type"] == "Limit" and node["Plan Width"] == 24)
lookup = next(node for node in nodes
              if node.get("Index Name") == "pk_geo_observation_runs"
              and node.get("Actual Loops") == 20)
assert limit["Actual Rows"] == 20
assert page["Plan"]["Temp Written Blocks"] < 4096
result = {
    "deep_page_execution_ms": page["Execution Time"],
    "deep_page_temp_written_blocks": page["Plan"]["Temp Written Blocks"],
    "page_key_width": limit["Plan Width"],
    "selected_page_rows": limit["Actual Rows"],
    "full_json_pk_lookups": lookup["Actual Loops"],
    "passed": True,
}
(evidence / "query-plan-check.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
