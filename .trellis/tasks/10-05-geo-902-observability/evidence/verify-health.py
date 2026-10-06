"""本任务隔离进程证据：临时PG、独立Redis、真实Celery/Beat，无真实provider。"""

import json
import os
import subprocess
import time
from pathlib import Path
from uuid import uuid4

from tests.integration.test_migrations import run_alembic, temporary_database

ROOT = Path(__file__).resolve().parents[4]
prefix = "geo902-health-" + uuid4().hex[:10]
network = prefix + "-network"
redis = prefix + "-redis"
containers = [prefix + "-worker", prefix + "-scheduler"]


def docker(*args, check=True):
    result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=25)
    if check and result.returncode:
        raise RuntimeError("隔离Docker命令失败；输出保留低敏状态，不展示配置")
    return result


def health(name, component):
    result = docker("exec", name, "python", "-m", "app.geo_observability", "health", component,
                    check=False)
    return result.returncode, json.loads(result.stdout)


def await_healthy(name, component):
    for _ in range(15):
        status, body = health(name, component)
        if status == 0:
            print(json.dumps({"phase": "healthy", **body}), flush=True)
            return
        time.sleep(3)
    print(json.dumps(body), flush=True)
    raise RuntimeError("真实进程未达到健康状态")


try:
    docker("network", "create", network)
    docker("run", "--rm", "-d", "--name", redis, "--network", network, "redis:7-alpine")
    with temporary_database("partsignal_geo902_live") as (url, env, backend):
        run_alembic(env, backend, "head")
        database = url.replace("postgresql://", "postgresql+psycopg://").replace(
            "127.0.0.1", "host.docker.internal")
        for name, component in zip(containers, ("worker", "scheduler"), strict=True):
            command = ("worker", "--loglevel=WARNING", "--concurrency=1",
                       "--pidfile=/tmp/partsignal-worker.pid") if component == "worker" else (
                       "beat", "--loglevel=WARNING", "--schedule=/tmp/geo902-beat",
                       "--pidfile=/tmp/partsignal-beat.pid")
            docker("run", "--rm", "-d", "--name", name, "--network", network,
                   "-v", str(ROOT / "backend") + ":/app:ro",
                   "-e", "APP_ENV=test", "-e", "DATABASE_URL=" + database,
                   "-e", "REDIS_URL=redis://" + redis + ":6379/0",
                   "-e", "GEO_MONITORING_ENABLED=true", "-e", "GEO_API_COLLECTION_ENABLED=false",
                   "partsignal-backend:test", "celery", "-A", "app.worker:celery_app", *command)
            await_healthy(name, component)
        # STOP让进程仍存在；worker须由targeted ping识别失联。
        docker("kill", "--signal=STOP", containers[0])
        status, body = health(containers[0], "worker")
        assert status == 1 and body["checks"]["celery_ping"] is False
        print(json.dumps({"phase": "worker_stopped_pid_alive", **body}), flush=True)
        docker("kill", "--signal=CONT", containers[0])
        await_healthy(containers[0], "worker")
        # Scheduler没有control ping，真实停止超过本机90秒期限。
        docker("kill", "--signal=STOP", containers[1])
        for _ in range(19):
            time.sleep(5)
        status, body = health(containers[1], "scheduler")
        assert status == 1 and body["checks"]["local_heartbeat"] is False
        print(json.dumps({"phase": "scheduler_stopped_stale", **body}), flush=True)
        docker("kill", "--signal=CONT", containers[1])
        await_healthy(containers[1], "scheduler")
        docker("stop", redis)
        for name, component in zip(containers, ("worker", "scheduler"), strict=True):
            status, body = health(name, component)
            assert status == 1 and body["checks"]["redis"] is False
            print(json.dumps({"phase": "broker_stopped", **body}), flush=True)
        result = docker("exec", containers[0], "python", "-m", "app.geo_observability", "snapshot")
        snapshot = json.loads(result.stdout)
        assert snapshot["schema_version"] == 1
        assert snapshot["api_daily"]["calls"] == 0
        result = docker("exec", containers[0], "python", "-m", "app.geo_observability", "metrics")
        assert "geo_observability_up 1" in result.stdout
        print("LIVE_HEALTH_PASS worker/scheduler/stop/stale/broker/CLI external_calls=0", flush=True)
finally:
    for name in containers:
        docker("kill", "--signal=CONT", name, check=False)
        docker("rm", "-f", name, check=False)
    docker("rm", "-f", redis, check=False)
    docker("network", "rm", network, check=False)
