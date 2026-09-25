"""在独立 POSIX session 中运行 E2E 命令，并有界等待整组后代退出。"""

from __future__ import annotations

import argparse
import errno
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from collections.abc import Sequence


DEFAULT_GRACE_SECONDS = 30.0
DEFAULT_KILL_WAIT_SECONDS = 5.0


def normalize_returncode(returncode: int) -> int:
    """把被信号终止的 subprocess 状态转换为 shell 惯用退出码。"""
    return 128 - returncode if returncode < 0 else returncode


def process_group_exists(process_group_id: int) -> bool:
    """通过 ps 只读观察 process group，不向已回收 PGID 发送任何信号。"""
    return bool(group_member_pids(process_group_id, anchor_pid=-1))


def wait_for_process_group_disappearance(
    process_group_id: int,
    kill_wait_seconds: float,
) -> bool:
    """在独立 deadline 内只读等待 SIGKILL 后的 process group 消失。"""
    deadline = time.monotonic() + kill_wait_seconds
    while True:
        try:
            exists = process_group_exists(process_group_id)
        except (PermissionError, OSError, subprocess.SubprocessError, ValueError):
            exists = True
        if not exists:
            return True
        now = time.monotonic()
        if now >= deadline:
            print(
                "E2E_PROCESS_GROUP status=kill-wait-timeout exit=137",
                file=sys.stderr,
                flush=True,
            )
            return False
        time.sleep(min(0.02, max(0.0, deadline - now)))


def group_member_pids(process_group_id: int, anchor_pid: int) -> list[int]:
    """读取目标 process group 成员；检查进程运行在独立 session 中。"""
    result = subprocess.run(
        ["ps", "-axo", "pid=,pgid="],
        check=True,
        capture_output=True,
        start_new_session=True,
        text=True,
    )
    members: list[int] = []
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) != 2:
            continue
        process_id, group_id = (int(value) for value in fields)
        if group_id == process_group_id and process_id != anchor_pid:
            members.append(process_id)
    return members


def kill_owned_group(process_group_id: int, signum: int) -> None:
    """向 anchor 持有的当前组发信号，同时避免 anchor 递归处理自己的信号。"""
    previous_handler = signal.signal(signum, signal.SIG_IGN)
    try:
        os.killpg(process_group_id, signum)
    except ProcessLookupError:
        pass
    finally:
        signal.signal(signum, previous_handler)


def run_group_anchor(command: Sequence[str], grace_seconds: float) -> int:
    """作为稳定 session/group leader，等待命令及其全部同组后代。"""
    anchor_pid = os.getpid()
    process_group_id = os.getpgrp()
    received_signal: int | None = None

    def forward_signal(signum: int, _frame: object) -> None:
        nonlocal received_signal
        if received_signal is None:
            received_signal = signum
        # 非交互 shell 的后台后代可能继承不可捕获的 SIGINT；TERM 能可靠
        # 收敛整组，最终仍由 received_signal 保留操作者对应的 130。
        group_signal = signal.SIGTERM if signum == signal.SIGINT else signum
        kill_owned_group(process_group_id, group_signal)

    previous_handlers = {
        signum: signal.signal(signum, forward_signal)
        for signum in (signal.SIGINT, signal.SIGTERM)
    }
    try:
        child = subprocess.Popen(command)
        if received_signal is not None:
            forward_signal(received_signal, None)
        returncode = child.wait()
        deadline = time.monotonic() + grace_seconds
        while True:
            try:
                remaining = group_member_pids(process_group_id, anchor_pid)
            except (OSError, subprocess.SubprocessError, ValueError):
                print(
                    "E2E_PROCESS_GROUP status=inspection-failed action=SIGKILL",
                    file=sys.stderr,
                    flush=True,
                )
                os.killpg(process_group_id, signal.SIGKILL)
                raise AssertionError("SIGKILL 应终止 process-group anchor")
            if not remaining:
                break
            if time.monotonic() >= deadline:
                print(
                    "E2E_PROCESS_GROUP status=timeout action=SIGKILL",
                    file=sys.stderr,
                    flush=True,
                )
                # anchor 始终占有 PGID；在此之前 group identity 不会被复用。
                os.killpg(process_group_id, signal.SIGKILL)
                raise AssertionError("SIGKILL 应终止 process-group anchor")
            time.sleep(min(0.02, max(0.0, deadline - time.monotonic())))
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)

    if received_signal is not None:
        return 128 + received_signal
    return normalize_returncode(returncode)


def run_supervisor(
    command: Sequence[str],
    grace_seconds: float,
    kill_wait_seconds: float,
) -> int:
    """启动稳定 group anchor，并把调用方信号交给该 anchor。"""
    worker_pid: int | None = None
    received_signal: int | None = None

    def forward_signal(signum: int, _frame: object) -> None:
        nonlocal received_signal
        if received_signal is None:
            received_signal = signum
        if worker_pid is None:
            return
        try:
            os.kill(worker_pid, signum)
        except ProcessLookupError:
            pass

    previous_handlers = {
        signum: signal.signal(signum, forward_signal)
        for signum in (signal.SIGINT, signal.SIGTERM)
    }
    try:
        worker_command = [
            sys.executable,
            str(Path(__file__).resolve()),
            "--group-anchor",
            "--grace-seconds",
            str(grace_seconds),
            "--",
            *command,
        ]
        worker = subprocess.Popen(worker_command, start_new_session=True)
        worker_pid = worker.pid
        if received_signal is not None:
            forward_signal(received_signal, None)
        returncode = worker.wait()
        # anchor 已被 wait 回收；先撤销可写 PID ownership。此后的信号只记录
        # 最终 130/143，不得再向可能复用的数值 PID/PGID 发送任何信号。
        worker_pid = None
        # timeout 分支由 anchor 对整组发 SIGKILL；继续只读等待内核确认该组消失，
        # 避免 scanner 与仍在退出的 reporter/worker 交错。
        if returncode == -signal.SIGKILL:
            wait_for_process_group_disappearance(worker.pid, kill_wait_seconds)
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)

    if received_signal is not None:
        return 128 + received_signal
    return normalize_returncode(returncode)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--group-anchor", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument(
        "--grace-seconds",
        type=float,
        default=DEFAULT_GRACE_SECONDS,
        help="直接命令退出后等待同组后代的秒数",
    )
    parser.add_argument(
        "--kill-wait-seconds",
        type=float,
        default=DEFAULT_KILL_WAIT_SECONDS,
        help="SIGKILL 后只读等待 process group 消失的秒数",
    )
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command[:1] == ["--"]:
        args.command = args.command[1:]
    if not args.command:
        parser.error("必须提供 E2E 子命令")
    if args.grace_seconds <= 0:
        parser.error("--grace-seconds 必须大于 0")
    if args.kill_wait_seconds <= 0:
        parser.error("--kill-wait-seconds 必须大于 0")
    return args


def main() -> None:
    args = parse_args()
    try:
        if args.group_anchor:
            status = run_group_anchor(args.command, args.grace_seconds)
        else:
            status = run_supervisor(
                args.command,
                args.grace_seconds,
                args.kill_wait_seconds,
            )
    except OSError as error:
        if error.errno == errno.ENOENT:
            raise SystemExit(127) from None
        raise
    raise SystemExit(status)


if __name__ == "__main__":
    main()
