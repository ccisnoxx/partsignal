"""PSR-005 可重复的入口与当前文档验收；只解析，不启动或部署服务。"""

import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[4]
SCOPE = (
    "当前支持人工 GEO 数据录入和已经实现的 API 型采集。"
    "Browser Collector、浏览器会话材料、自动登录和浏览器页面采集属于后续功能，"
    "当前版本不支持、不开启、不部署。"
)


def output(command):
    return subprocess.check_output(command, cwd=ROOT, text=True)


def main():
    plan = output(["make", "-n", "bootstrap", "lint", "typecheck", "test-unit", "e2e", "verify"])
    assert not re.search("browser-collector|test-geo-browser|geo-browser|browser-session", plan)
    for token in (
        "npm --prefix frontend ci", "ruff check backend", "pytest backend/tests/unit",
        "mypy --config-file backend/pyproject.toml backend/app", "npm --prefix frontend run test",
        "deploy/scripts/e2e-local.sh", "deploy/scripts/e2e-geo.sh",
        "npm --prefix frontend run e2e", "test-geo-collector-contract.py",
    ):
        assert token in plan, token
    print("Make 六个默认目标：零 Browser 专属执行；普通 Playwright/API 合同保留")

    for profile in ([], ["--profile", "geo-browser"], ["--profile", "*"]):
        config = json.loads(output([
            "docker", "compose", "--env-file", ".env", "-f", "deploy/compose.dev.yaml",
            *profile, "config", "--format", "json",
        ]))
        assert "browser-collector" not in config["services"]
        for service in config["services"].values():
            assert "geo-browser" not in service.get("profiles", [])
            assert not any("geo-browser" in m["target"] for m in service.get("volumes", []))
        # 私有环境值只在内存比较，不打印 Compose JSON。
    print("Dev Compose 默认/Browser/全部 profile：零 Browser 服务和会话挂载")

    changed = Path(__file__).with_name("changed-files.txt").read_text().splitlines()
    docs = [p for p in changed if p.endswith(".md") and p not in (
        ".trellis/spec/infra/ci-execution.md", "docs/geo-monitoring/CHANGELOG.md",
    )]
    for name in docs:
        text = (ROOT / name).read_text()
        assert SCOPE in text, name
        assert "#当前-r7geo-801-独立-browser-骨架" not in text, name
        assert "部署文档GEO-802章节" not in text, name
    print(f"当前产品/开发/测试/运维一致性：{len(docs)} 份统一声明，无本轮删除章节的活动引用")

    for name in (
        "docs/geo-monitoring/03-technical/01-technical-architecture.md",
        "docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md",
    ):
        for block in re.findall(r"```mermaid\n(.*?)```", (ROOT / name).read_text(), re.S):
            assert not re.search("BrowserWorker|BrowserCollector|External AI UI", block), name
    print("当前核心架构图：零 Browser 服务节点")

    checksums = ROOT / "docs/geo-monitoring/SHA256SUMS"
    rows = checksums.read_text().splitlines()
    for row in rows:
        expected, name = row.split("  ", 1)
        assert hashlib.sha256((checksums.parent / name).read_bytes()).hexdigest() == expected, name
    print(f"GEO 文档 SHA256：{len(rows)} 条目全部匹配")


if __name__ == "__main__":
    main()
