"""从仓库源码冻结 GEO-003 证据；不连接数据库或外部服务。

从仓库根通过 uv run --project backend python <本文件> <输出目录> 执行。
快照不是运行库 catalog 或新的合同权威。默认拒绝覆盖，避免改写冻结证据。
"""

import ast
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import yaml

from app import models  # noqa: F401
from app.db import Base
from app.main import app


root = Path.cwd()
output = Path(sys.argv[1])
output.mkdir(parents=True, exist_ok=False)
sources: set[str] = set()


def read(path: str) -> str:
    sources.add(path)
    return (root / path).read_text()


def save(name: str, value: object) -> None:
    (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


contract = yaml.safe_load(read("contracts/openapi.yaml"))
paths = {
    path: value for path, value in contract["paths"].items()
    if path.startswith(("/api/v1/geo-", "/api/v1/query-topics"))
}
components = contract["components"]
references: set[str] = set()


def collect_references(value: object) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "$ref" and item.startswith("#/components/"):
                if item not in references:
                    references.add(item)
                    _, _, group, name = item.split("/")
                    collect_references(components[group][name])
            else:
                collect_references(item)
    elif isinstance(value, list):
        for item in value:
            collect_references(item)


collect_references(paths)
for name, value in components["schemas"].items():
    if name.startswith(("Geo", "LegacyGeo", "ManualGeo", "QueryTopic")):
        collect_references({"$ref": f"#/components/schemas/{name}"})
selected_components: dict[str, dict] = {"securitySchemes": components["securitySchemes"]}
for reference in sorted(references):
    _, _, group, name = reference.split("/")
    selected_components.setdefault(group, {})[name] = components[group][name]
save("openapi.json", {
    "openapi": contract["openapi"], "info": contract["info"],
    "security": contract.get("security", []),
    "paths": paths, "components": selected_components,
})

runtime = app.openapi()
assert all(runtime["paths"][p][m]["operationId"] == operation["operationId"]
           for p, value in paths.items() for m, operation in value.items()
           if m in {"get", "post", "patch", "delete"})


def parameter_summary(parameter: dict) -> dict:
    if "$ref" in parameter:
        _, _, group, name = parameter["$ref"].split("/")
        parameter = components[group][name]
    return {"name": parameter["name"], "in": parameter["in"],
            "required": parameter.get("required", False)}


api_source = read("frontend/src/domains/geo/geo.api.ts")
keys_start = api_source.index("const geoKeys = {")
keys_end = api_source.index("\n};", keys_start) + len("\n};")
save("routes.json", {
    "api": [
        {"path": p, "method": m.upper(), "operation_id": operation["operationId"],
         "response_codes": sorted(operation["responses"]),
         "parameters": [parameter_summary(param)
                        for param in operation.get("parameters", [])]}
        for p, value in paths.items() for m, operation in value.items()
        if m in {"get", "post", "patch", "delete"}
    ],
    "frontend": [
        {"file": str(p), "route_ids": re.findall(r"createFileRoute\('([^']+)'\)", read(str(p)))}
        for p in sorted(Path("frontend/src/routes/_app/geo").rglob("*.tsx"))
    ],
    "query_key_owner": "frontend/src/domains/geo/geo.api.ts",
    "query_keys_source": api_source[keys_start:keys_end],
    "route_note": "父级 /geo 只有 Outlet；不存在已实现的 GEO Overview 页面。",
})

table_names = ["geo_observations", "geo_observation_citations",
               "geo_observation_publications", "geo_observation_attachments",
               "query_topics", "file_records", "content_task_geo_sources"]
save("database.json", {
    "evidence_kind": "运行时 ORM metadata；不包含仅由 Alembic 创建的全部 CHECK/index/trigger",
    "live_database_verified": False,
    "tables": {
        name: {
            "columns": [
                {"name": c.name, "type": str(c.type), "nullable": c.nullable,
                 "primary_key": c.primary_key,
                 "foreign_keys": [
                     {"target": fk.target_fullname, "ondelete": fk.ondelete}
                     for fk in sorted(c.foreign_keys, key=lambda fk: fk.target_fullname)
                 ]}
                for c in Base.metadata.tables[name].columns
            ],
            "orm_constraints": sorted(
                str(c.name) for c in Base.metadata.tables[name].constraints
            ),
        } for name in table_names
    },
})

migrations = []
for p in sorted(Path("backend/alembic/versions").glob("*.py")):
    source = read(str(p))
    values = {}
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name) and target.id in {"revision", "down_revision"}:
                values[target.id] = ast.literal_eval(node.value)
    migrations.append({"file": str(p), **values,
                       "geo_or_topic_source_mentions": "geo_" in source or "query_topics" in source})
parents = {m["down_revision"] for m in migrations}
heads = [m["revision"] for m in migrations if m["revision"] not in parents]
assert heads == ["0043_geo_platform_identity"], heads
save("migrations.json", {"source_heads": heads, "live_revision_verified": False,
                         "revisions": migrations})

symbols = {}
for path in ["backend/app/services/geo_observation.py",
             "backend/app/services/content_planning.py"]:
    source = read(path)
    symbols[path] = [
        {"symbol": n.name, "line": n.lineno, "end_line": n.end_lineno}
        for n in ast.parse(source).body if isinstance(n, (ast.FunctionDef, ast.ClassDef))
    ]
geo_symbols = {n["symbol"] for n in symbols["backend/app/services/geo_observation.py"]}
callers = []
for p in sorted(Path("backend/app").rglob("*.py")):
    source = p.read_text()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Call):
            name = (node.func.id if isinstance(node.func, ast.Name)
                    else node.func.attr if isinstance(node.func, ast.Attribute) else None)
            if name in geo_symbols:
                sources.add(str(p))
                callers.append({"file": str(p), "line": node.lineno, "symbol": name})
save("queries.json", {"symbols": symbols, "static_call_sites": callers,
                      "note": "静态符号/调用入口，非动态 trace；未测量 SQL 执行计划或性能。"})

test_files = set(Path("backend/tests").rglob("test_geo*.py"))
test_files.add(Path("backend/tests/integration/test_query_topic_list.py"))
for p in Path("backend/tests").rglob("test_*.py"):
    source = p.read_text()
    if any(term in source for term in ("GeoObservation", "GeoInsights", "geo_observation",
                                       "content_task_geo_sources")):
        test_files.add(p)
test_files.update(Path("frontend/src/domains/geo").glob("*.test.*"))
test_files.update(Path("frontend/tests/e2e").glob("*geo*.spec.ts"))
tests = []
for p in sorted(test_files):
    source = read(str(p))
    if p.suffix == ".py":
        entries = [{"name": n.name, "line": n.lineno}
                   for n in ast.walk(ast.parse(source))
                   if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                   and n.name.startswith("test_")]
    else:
        entries = [{"line": i, "declaration": line.strip()}
                   for i, line in enumerate(source.splitlines(), 1)
                   if re.search(r"\b(?:test|it)\s*(?:\.each\([^)]*\))?\s*\(", line)]
    tests.append({"file": str(p), "source_test_declarations": entries})
save("tests.json", {"files": tests,
                    "note": "声明数不是展开后的用例数；收集与实际执行结果见 validation.md。"})

for pattern in ["frontend/src/domains/geo/*", "frontend/tests/e2e/fixtures/*geo*",
                "backend/app/models/*.py", "backend/app/schemas/geo_files.py",
                "backend/app/schemas/configuration.py", "backend/app/routers/observation.py",
                "backend/app/routers/planning.py", "backend/app/migration_schema_v1.py",
                "backend/app/worker.py", "backend/app/config.py", "backend/app/services/file_records.py",
                "contracts/database.md", "frontend/src/shared/api/generated/schema.d.ts",
                "Makefile", "backend/pyproject.toml", "backend/uv.lock", "frontend/package-lock.json",
                "frontend/playwright.config.ts", "deploy/scripts/e2e-local.sh"]:
    sources.update(str(p) for p in root.glob(pattern) if p.is_file())
relative = {str(Path(p).relative_to(root)) if Path(p).is_absolute() else p for p in sources}
save("sources.json", {
    "task": "GEO-003", "release": "R0", "frozen_date": "2026-10-01",
    "head": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
    "branch": subprocess.check_output(["git", "branch", "--show-current"], text=True).strip(),
    "authority": "源码/合同冻结证据；不代表生产状态或未来目标合同已实现。",
    "files": {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in sorted(relative)},
})
print(json.dumps({"paths": len(paths), "operations": sum(len(p) for p in paths.values()),
                  "schemas": len(selected_components["schemas"]), "tables": len(table_names),
                  "migrations": len(migrations), "test_files": len(tests),
                  "source_files": len(relative)}, ensure_ascii=False))
