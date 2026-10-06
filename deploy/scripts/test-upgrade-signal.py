#!/usr/bin/env python3
"""验证忽略 SIGTERM 的维护子孙会在有限期限内被结束。"""

import fcntl
import importlib.util
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SCRIPT = Path(__file__).resolve().with_name("prepare-production-data.py")


def executable(pid):
    status = subprocess.run(["ps", "-p", str(pid), "-o", "stat="],
                            capture_output=True, text=True).stdout.strip()
    return bool(status) and not status.startswith("Z")


def recovery_entry_signal(signum=signal.SIGTERM, inherited=None, *, wrapped=False):
    """直接调用 Runbook 的恢复入口，在真实子命令阻塞期间中断父 PID。"""
    spec = importlib.util.spec_from_file_location("recovery_fixture", SCRIPT.with_name("test-upgrade-recovery.py"))
    fixture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture)
    data = fixture.UpgradeRecoveryTests("runTest")
    data.setUp()
    process = None
    descendants = []
    try:
        data.deploying()
        before = (data.live / fixture.owner.STATE_FILE_NAME).read_bytes()
        runtime = data.root / "runtime.env"
        runtime.write_text("APP_ENV=production\n")
        runtime.chmod(0o600)
        binary = data.root / "bin"
        binary.mkdir()
        docker = binary / "docker"
        docker.write_text("""#!/usr/bin/env python3
import json, os, signal, subprocess, sys, time
from pathlib import Path
assert sys.argv[1] == 'ps', sys.argv[1:]
root=Path(os.environ['SIGNAL_FIXTURE_ROOT'])
signal.signal(signal.SIGTERM, signal.SIG_IGN)
signal.signal(signal.SIGINT, signal.SIG_IGN)
grand=subprocess.Popen([sys.executable, '-c', "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); signal.signal(signal.SIGINT, signal.SIG_IGN); time.sleep(60)"])
(root/'probe-ready').write_text(json.dumps([os.getpid(), grand.pid]))
while True: time.sleep(0.02)
""")
        docker.chmod(0o700)
        command = [sys.executable, str(data.repository / "deploy/scripts/prepare-production-data.py"),
                   "recover-upgrade", data.args.manifest]
        for name, value in vars(data.args).items():
            if name != "manifest":
                command.extend(["--" + name.replace("_", "-"), value])
        if wrapped:
            command = [sys.executable, str(SCRIPT), "run-locked", *command]
        environment = {**os.environ, "SIGNAL_FIXTURE_ROOT": str(data.root),
                       "PARTSIGNAL_RUNTIME_ENV_FILE": str(runtime),
                       "PATH": str(binary) + os.pathsep + os.environ["PATH"]}
        environment.pop("PARTSIGNAL_MAINTENANCE_LOCK_FD", None)
        descriptor = None
        if inherited:
            descriptor = os.open(data.root / "lock", os.O_RDWR | os.O_CREAT, 0o600)
            if inherited == "locked":
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            environment["PARTSIGNAL_MAINTENANCE_LOCK_FD"] = str(descriptor)
        try:
            process = subprocess.Popen(command, env=environment, pass_fds=(() if descriptor is None else (descriptor,)),
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        finally:
            if descriptor is not None:
                os.close(descriptor)
        deadline = time.monotonic() + 8
        ready = data.root / "probe-ready"
        while not ready.exists():
            if process.poll() is not None or time.monotonic() > deadline:
                output = process.communicate(timeout=1)
                raise AssertionError(f"真实恢复 probe 未就绪：{output!r}")
            time.sleep(0.01)
        descendants = json.loads(ready.read_text())
        with data.root.joinpath("lock").open("r+") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                pass
            else:
                raise AssertionError("真实恢复 probe 运行时锁未占用")
            process.send_signal(signum)
            deadline = time.monotonic() + 13
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    assert time.monotonic() < deadline, "真实恢复中断后锁未释放"
                    time.sleep(0.01)
                else:
                    assert not any(executable(pid) for pid in descendants), "真实恢复子孙仍可执行时锁提前释放"
                    break
        output = process.communicate(timeout=1)
        assert process.returncode == 128 + signum, (process.returncode, output)
        assert (data.live / fixture.owner.STATE_FILE_NAME).read_bytes() == before
        print(f"真实 recover-upgrade：inherited={inherited} wrapped={wrapped} signal={signum}；子孙结束后才释放锁，原子状态字节不变")
    finally:
        if process is not None and process.poll() is None:
            process.send_signal(signal.SIGTERM)
            process.communicate(timeout=13)
        for pid in descendants:
            if executable(pid):
                os.kill(pid, signal.SIGKILL)
        data.tearDown()


def main():
    recovery_entry_signal()
    for inherited in ("self-opened", "locked"):
        for signum in (signal.SIGTERM, signal.SIGINT):
            recovery_entry_signal(signum, inherited)
    recovery_entry_signal(wrapped=True)
    with tempfile.TemporaryDirectory(prefix="geo1007-signal-") as temporary:
        root = Path(temporary).resolve()
        lock = root / "maintenance.lock"
        state = root / "state.json"
        state.write_text('{"phase":"UPGRADE_DEPLOYING"}')
        child = root / "child.py"
        child.write_text("""import json, os, signal, subprocess, sys, time
from pathlib import Path
root=Path(os.environ['SIGNAL_FIXTURE_ROOT'])
signal.signal(signal.SIGTERM, signal.SIG_IGN)
signal.signal(signal.SIGINT, signal.SIG_IGN)
grand=subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
(root/'ready').write_text(json.dumps([os.getpid(), grand.pid]))
while True: time.sleep(0.1)
""")
        environment = {
            **os.environ,
            "SIGNAL_FIXTURE_ROOT": str(root),
            "PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS": "1",
            "PARTSIGNAL_MAINTENANCE_LOCK_FILE": str(lock),
        }
        process = subprocess.Popen(
            [sys.executable, str(SCRIPT), "run-locked", sys.executable, str(child)],
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        descendants = []
        try:
            deadline = time.monotonic() + 5
            while not (root / "ready").exists():
                if process.poll() is not None or time.monotonic() > deadline:
                    raise AssertionError("信号夹具未就绪")
                time.sleep(0.01)
            descendants = json.loads((root / "ready").read_text())
            process.send_signal(signal.SIGTERM)
            with lock.open("r+") as descriptor:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    pass
                else:
                    raise AssertionError("子孙仍存活时维护锁提前释放")
            process.communicate(timeout=13)
            assert process.returncode == 143
            for pid in descendants:
                status = subprocess.run(
                    ["ps", "-p", str(pid), "-o", "stat="],
                    capture_output=True,
                    text=True,
                ).stdout.strip()
                assert not status or status.startswith("Z"), "SIGKILL 后仍有可执行子孙"
            with lock.open("r+") as descriptor:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            assert state.read_text() == '{"phase":"UPGRADE_DEPLOYING"}'
            print(
                "SIGTERM ignored：10秒期限内结束整组；退出前锁占用、退出后释放、phase/data未推进"
            )
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
                process.communicate(timeout=13)
            for pid in descendants:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass


if __name__ == "__main__":
    main()
