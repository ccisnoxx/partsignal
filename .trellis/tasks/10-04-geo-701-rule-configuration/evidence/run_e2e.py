"""GEO-701隔离本地模拟环境，仅执行目标真实浏览器用例。"""
import os
import subprocess
import sys

env = os.environ.copy()
env.update(
    DATABASE_URL="postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:18571/partsignal",
    REDIS_URL="redis://127.0.0.1:18572/14",
    PARTSIGNAL_E2E_SPEC="tests/e2e/rules-real-stack.spec.ts",
    PARTSIGNAL_E2E_GEO_MODE="",
)
sys.exit(subprocess.run(["deploy/scripts/e2e-local.sh"], env=env).returncode)
