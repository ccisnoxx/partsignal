"""维护执行生命周期：私有 worker、信号转发和子孙停止证明。"""

from __future__ import annotations

import json
import os
import select
import signal
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ExecutionResult:
    exit_code: int
    worker_exit_code: int
    signal: int
    progress: dict[str, Any]


def exit_code(status: int) -> int:
    return 128 - status if status < 0 else status


def wait_group_stopped(group: int) -> None:
    """投递 SIGKILL 不证明停止；未知 OS 状态时持续持锁。"""
    reported = False
    while True:
        try:
            os.killpg(group, 0)
        except ProcessLookupError:
            return
        except PermissionError:
            # macOS 对仅含 zombie 的组也可能返回 EPERM，必须继续读取执行状态。
            pass
        try:
            result = subprocess.run(
                ["ps", "-eo", "pgid=,stat="],
                check=True,
                capture_output=True,
                text=True,
                timeout=5,
            )
            rows = [line.split() for line in result.stdout.splitlines()]
            if any(len(row) != 2 or not row[0].isdigit() for row in rows):
                raise ValueError("进程状态格式无效")
            if not any(
                int(pgid) == group and not state.startswith("Z") for pgid, state in rows
            ):
                return
        except (OSError, subprocess.SubprocessError, ValueError):
            if not reported:
                print(
                    "维护子孙停止状态不可读；持续持锁，等待系统状态恢复。",
                    file=sys.stderr,
                )
                reported = True
        time.sleep(0.05)


def signal_group(group: int, signum: int) -> None:
    """EPERM 不能视为已停止；只在 OS 证明整组不可执行后返回。"""
    try:
        os.killpg(group, signum)
    except ProcessLookupError:
        pass
    except PermissionError:
        wait_group_stopped(group)


def descendant_groups(root: int) -> set[int]:
    """清理嵌套 supervisor 的私有进程组，不能只终止外层 worker。"""
    result = subprocess.run(
        ["ps", "-eo", "pid=,ppid=,pgid="],
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
    )
    rows = [line.split() for line in result.stdout.splitlines()]
    if any(len(row) != 3 or not all(value.isdigit() for value in row) for row in rows):
        raise ValueError("维护进程树状态格式无效")
    processes = [(int(pid), int(parent), int(group)) for pid, parent, group in rows]
    descendants = {root}
    while True:
        expanded = descendants | {
            pid for pid, parent, _ in processes if parent in descendants
        }
        if expanded == descendants:
            break
        descendants = expanded
    return {root} | {
        group
        for pid, _, group in processes
        if pid in descendants and group in descendants
    }


def supervise(
    operation: Callable[[Callable[[dict[str, Any]], None]], int],
) -> ExecutionResult:
    """必须由持锁父进程调用；fork callback 无公开的无监督 CLI。"""
    reader, writer = os.pipe()
    os.set_blocking(reader, False)
    progress: dict[str, Any] = {}
    pending = b""
    interrupted = 0
    deadline = 0.0
    child: int | None = None
    ready = False
    owned_groups: set[int] = set()

    def forward(signum: int, _frame: Any) -> None:
        nonlocal interrupted, deadline
        if not interrupted:
            interrupted = signum
            deadline = time.monotonic() + 10

    handlers = {s: signal.signal(s, forward) for s in (signal.SIGINT, signal.SIGTERM)}
    sys.stdout.flush()
    sys.stderr.flush()
    try:
        child = os.fork()
        if child == 0:
            os.close(reader)
            os.setsid()
            worker_interrupted = 0

            def remember_signal(signum: int, _frame: Any) -> None:
                nonlocal worker_interrupted
                worker_interrupted = worker_interrupted or signum

            for signum in handlers:
                signal.signal(signum, remember_signal)

            def publish(value: dict[str, Any]) -> None:
                if worker_interrupted:
                    raise SystemExit(128 + worker_interrupted)
                # pipe 由本次 fork 私有创建，外部 subprocess 不继承，不能从 env 自报事实。
                payload = json.dumps(value, separators=(",", ":")).encode() + b"\n"
                if len(payload) > 4096 or os.write(writer, payload) != len(payload):
                    raise RuntimeError("维护执行进度无法完整交付")

            try:
                publish({"ready": True})
                code = operation(publish)
            except BaseException as error:
                if isinstance(error, SystemExit) and isinstance(error.code, int):
                    code = error.code
                else:
                    print(f"维护执行未完成：{type(error).__name__}", file=sys.stderr)
                    code = 2
            sys.stdout.flush()
            sys.stderr.flush()
            os.close(writer)
            os._exit(code if isinstance(code, int) and 0 <= code <= 255 else 2)

        os.close(writer)
        writer = -1
        while True:
            if select.select([reader], [], [], 0.05)[0]:
                chunk = os.read(reader, 4096)
                pending += chunk
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    message = json.loads(line)
                    progress.update(message)
                    if message.get("ready") and not ready:
                        ready = True
            if interrupted and ready:
                # 在杀死上层 owner 之前冻结子孙组；内层 owner 消失后不能再沿 PPID 找回。
                discovered = descendant_groups(child)
                for group in discovered - owned_groups:
                    signal_group(group, interrupted)
                owned_groups.update(discovered)
                if time.monotonic() >= deadline:
                    for group in sorted(owned_groups - {child}):
                        signal_group(group, signal.SIGKILL)
                    signal_group(child, signal.SIGKILL)
            waited, status = os.waitpid(child, os.WNOHANG)
            if waited:
                # 先停止仍可执行的子孙，锁与事实记录都不能早于停止证明。
                for group in sorted(owned_groups | {child}):
                    signal_group(group, signal.SIGKILL)
                    wait_group_stopped(group)
                # worker 退出前的最终进度必须读完，不能遗漏已创建的 attempt。
                while True:
                    chunk = os.read(reader, 4096)
                    if not chunk:
                        break
                    pending += chunk
                for line in pending.splitlines():
                    progress.update(json.loads(line))
                worker_code = exit_code(os.waitstatus_to_exitcode(status))
                return ExecutionResult(
                    128 + interrupted if interrupted else worker_code,
                    worker_code,
                    interrupted,
                    progress,
                )
    except BaseException:
        if child:
            # 父级解析/OS 异常同样不能留下仍可执行的 worker 后提前解锁。
            # 进程树不可读时保留锁，不能降级为只杀外层 PID。
            while True:
                try:
                    owned_groups.update(descendant_groups(child))
                    break
                except (OSError, subprocess.SubprocessError, ValueError):
                    time.sleep(0.05)
            for group in sorted(owned_groups - {child}):
                signal_group(group, signal.SIGKILL)
            signal_group(child, signal.SIGKILL)
            if not ready:
                try:
                    os.kill(child, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            try:
                os.waitpid(child, 0)
            except ChildProcessError:
                pass
            for group in owned_groups | {child}:
                wait_group_stopped(group)
        raise
    finally:
        os.close(reader)
        if writer >= 0:
            os.close(writer)
        for signum, handler in handlers.items():
            signal.signal(signum, handler)
