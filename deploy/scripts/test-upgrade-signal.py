#!/usr/bin/env python3
"""验证忽略 SIGTERM 的维护子孙会在有限期限内被结束。"""

import fcntl
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SCRIPT = Path(__file__).resolve().with_name("prepare-production-data.py")


def main():
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
