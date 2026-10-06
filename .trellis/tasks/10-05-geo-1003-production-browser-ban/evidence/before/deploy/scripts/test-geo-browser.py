#!/usr/bin/env python3
"""独立 Browser Compose/镜像边界与可选真实 runtime 验收；只使用本地内存页面。"""

import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
RUN_ID = "7fca3868-ad19-44ef-9d81-deb3d595ed29"


def execute(command, *, env=None, expected=0):
    result = subprocess.run(
        command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=180
    )
    if result.returncode != expected:
        # 此入口只接收自行构造的无secret环境，不输出完整Compose配置。
        raise AssertionError(f"命令失败：{command[0:3]}\n{result.stdout}\n{result.stderr}")
    return result.stdout


def configuration_checks(owner):
    runtime = owner / ".env"
    runtime.write_text((ROOT / ".env.example").read_text())
    deploy = owner / "deploy"
    deploy.mkdir()
    (owner / ".env.staging").write_text(runtime.read_text())
    for name in ("dev", "staging", "prod", "geo-browser"):
        (deploy / f"compose.{name}.yaml").write_text(
            (ROOT / f"deploy/compose.{name}.yaml").read_text()
        )
    env = {
        "PATH": os.environ["PATH"], "PARTSIGNAL_VERSION": "geo801-test",
        "PARTSIGNAL_BACKEND_IMAGE": "partsignal-backend",
        "PARTSIGNAL_FRONTEND_IMAGE": "partsignal-frontend-v2",
        "PARTSIGNAL_RUNTIME_ENV_FILE": str(runtime), "PARTSIGNAL_DATA_ROOT": str(owner / "data"),
    }
    for environment in ("dev", "staging", "prod"):
        base = ["docker", "compose", "--env-file", str(runtime),
                "-f", str(deploy / f"compose.{environment}.yaml")]
        default = json.loads(execute(base + ["config", "--format", "json"], env=env))
        assert "browser-collector" not in default["services"]
        configured = json.loads(execute(
            base + ["--profile", "geo-browser", "config", "--format", "json"], env=env
        ))
        service = configured["services"]["browser-collector"]
        assert service["profiles"] == ["geo-browser"]
        assert service["network_mode"] == "none" and not service.get("networks")
        assert not service.get("ports") and not service.get("depends_on")
        assert service["read_only"] and service["init"] and service["user"] == "pwuser"
        assert service["cap_drop"] == ["ALL"] and not service.get("cap_add")
        assert service["pids_limit"] == 128 and service["cpus"] == 1
        assert int(service["mem_limit"]) == 1024**3
        assert service["restart"] == "no"
        assert "no-new-privileges:true" in service["security_opt"]
        assert any(value.startswith("seccomp=") for value in service["security_opt"])
        assert service["environment"] == {
            "GEO_MONITORING_ENABLED": "false", "GEO_BROWSER_COLLECTION_ENABLED": "false",
            "GEO_BROWSER_KILL_SWITCH_FILE": "/run/control/STOP",
        }
        assert len(service["volumes"]) == 1
        assert service["volumes"][0]["target"] == "/run/control"
        assert service["volumes"][0]["read_only"]
        empty = json.loads(execute(
            base + ["--profile", "geo-browser", "config", "--format", "json"],
            env={**env, "GEO_MONITORING_ENABLED": "", "GEO_BROWSER_COLLECTION_ENABLED": ""}
        ))["services"]["browser-collector"]["environment"]
        assert empty["GEO_MONITORING_ENABLED"] == empty["GEO_BROWSER_COLLECTION_ENABLED"] == ""
        for role in ("api", "worker", "scheduler"):
            # production-async 本来默认不包含Worker/Beat，按其原profile单独解析。
            selected = configured if role in configured["services"] else json.loads(execute(
                base + ["--profile", "production-async", "config", "--format", "json"], env=env
            ))
            ordinary = selected["services"][role]
            if "image" in ordinary:
                assert ordinary["image"] != service["image"]
            assert all(v.get("target") != "/run/control" for v in ordinary.get("volumes", []))
    seccomp = json.loads((ROOT / "deploy/geo-browser-seccomp.json").read_text())
    assert seccomp["defaultAction"] == "SCMP_ACT_ERRNO"
    assert set(seccomp["syscalls"][0]["names"]) == {"clone", "setns", "unshare", "chroot"}
    print("Compose dev/staging/prod：默认无Browser；profile/资源/网络/凭据隔离通过")


def runtime_checks(owner):
    project = f"partsignal-geo801-{uuid4().hex[:12]}"
    image = f"partsignal-browser-collector:{project}"
    control = owner / "control"
    control.mkdir()
    marker = control / "STOP"
    marker.touch()
    env = {"PATH": os.environ["PATH"], "HOME": os.environ["HOME"],
           "PARTSIGNAL_BROWSER_COLLECTOR_VERSION": project,
           "PARTSIGNAL_GEO_BROWSER_CONTROL_DIR": str(control)}
    base = ["docker", "compose", "-p", project,
            "-f", str(ROOT / "deploy/compose.geo-browser.yaml")]
    active = base + ["--profile", "geo-browser"]
    built = False
    try:
        # 真正执行默认up，不能只拿config中缺少service当未启动证据。
        execute(base + ["up", "-d", "--no-build", "--pull", "never"], env=env, expected=1)
        assert not execute(base + ["ps", "--all", "-q"], env=env).strip()
        execute(["docker", "build", "-t", image, str(ROOT / "browser-collector")], env=env)
        built = True
        env.update(GEO_MONITORING_ENABLED="", GEO_BROWSER_COLLECTION_ENABLED="")
        execute(active + ["up", "-d", "--no-build", "--pull", "never",
                          "--wait", "--wait-timeout", "40"], env=env, expected=1)
        logs = execute(active + ["logs", "--no-log-prefix", "browser-collector"], env=env)
        assert logs.strip() == "BROWSER_CONFIGURATION_INVALID"
        env.update(GEO_MONITORING_ENABLED="false", GEO_BROWSER_COLLECTION_ENABLED="false")
        execute(active + ["up", "-d", "--no-build", "--pull", "never",
                          "--wait", "--wait-timeout", "40"], env=env)
        container = execute(active + ["ps", "-q", "browser-collector"], env=env).strip()
        inspected = json.loads(execute(["docker", "inspect", container], env=env))[0]
        assert inspected["State"]["Health"]["Status"] == "healthy"
        config = inspected["HostConfig"]
        assert config["NetworkMode"] == "none" and config["ReadonlyRootfs"]
        assert config["CapDrop"] == ["ALL"] and not config["CapAdd"]
        assert config["Memory"] == 1024**3 and config["PidsLimit"] == 128
        assert config["NanoCpus"] == 10**9 and not config["PortBindings"]
        assert not any(value.split("=", 1)[0] in {"DATABASE_URL", "REDIS_URL", "SESSION_SECRET",
                         "AI_CREDENTIAL_ENCRYPTION_KEY"} for value in inspected["Config"]["Env"])
        execute(active + ["exec", "-T", "browser-collector", "node", "-e",
                "const n=require('node:os').networkInterfaces();"
                "if(Object.keys(n).some(k=>k!=='lo')||process.getuid()===0)process.exit(1)"], env=env)

        def health():
            return json.loads(execute(active + ["exec", "-T", "browser-collector", "node", "-e",
                "fetch('http://127.0.0.1:8090/health').then(r=>r.json()).then(h=>console.log(JSON.stringify(h)))"], env=env))

        def refused(code):
            output = subprocess.run(active + ["exec", "-T", "browser-collector", "node",
                    "src/main.mjs", "claim", RUN_ID], cwd=ROOT, env=env,
                    capture_output=True, text=True, timeout=10)
            assert output.returncode == 1 and output.stderr.strip() == code

        def admission(code):
            # Desktop bind 的宿主写入可短暂延迟可见；只等观测状态，超过5秒即失败。
            deadline = time.monotonic() + 5
            while True:
                result = health()
                if result["collection"] == code:
                    return
                assert time.monotonic() < deadline, result
                time.sleep(0.1)

        assert health()["collection"] == "COLLECTOR_DISABLED"
        refused("COLLECTOR_DISABLED")
        env.update(GEO_MONITORING_ENABLED="true", GEO_BROWSER_COLLECTION_ENABLED="true")
        execute(active + ["up", "-d", "--force-recreate", "--no-build", "--pull", "never",
                          "--wait", "--wait-timeout", "40"], env=env)
        refused("COLLECTOR_DISABLED")
        marker.unlink()
        admission("BROWSER_ADAPTER_NOT_IMPLEMENTED")
        refused("BROWSER_ADAPTER_NOT_IMPLEMENTED")
        marker.touch()
        admission("COLLECTOR_DISABLED")
        refused("COLLECTOR_DISABLED")
        assert health()["session_probe"] == "NOT_IMPLEMENTED"
        execute(active + ["stop", "-t", "10"], env=env)
        container = execute(active + ["ps", "--all", "-q", "browser-collector"], env=env).strip()
        state = json.loads(execute(["docker", "inspect", container], env=env))[0]["State"]
        assert state["ExitCode"] == 0 and not state["Running"]
        print("真实容器：sandbox离线DOM健康、默认up零容器、非root/资源/网络、热kill、显式拒绝、正常停止通过")
    finally:
        execute(active + ["down", "--volumes", "--remove-orphans"], env=env)
        assert not execute(active + ["ps", "--all", "-q"], env=env).strip()
        # 只删除本轮随机tag，不清理共享镜像/其他项目。
        if built:
            execute(["docker", "image", "rm", image], env=env)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", action="store_true")
    args = parser.parse_args()
    # Docker Desktop 未必共享系统临时目录；仓库已共享路径用于实际 bind 验证。
    cache = ROOT / ".cache"
    cache.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="geo801-", dir=cache) as temporary:
        owner = Path(temporary)
        configuration_checks(owner)
        if args.runtime:
            runtime_checks(owner)


if __name__ == "__main__":
    main()
