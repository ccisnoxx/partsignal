#!/usr/bin/env python3
"""Codex 的只读 Trellis 状态索引；状态解析由 common.active_task 持有。"""
from __future__ import annotations
import json
import os
from pathlib import Path
import queue
import re
import sys
import threading


def read_input():
    pending = queue.Queue(maxsize=1)
    def read():
        try:
            pending.put(sys.stdin.read())
        except (OSError, ValueError) as exc:
            pending.put(exc)
    threading.Thread(target=read, daemon=True).start()
    try:
        raw = pending.get(timeout=1)
    except queue.Empty:
        raise ValueError('Hook 输入未结束，无法确认会话身份')
    if isinstance(raw, Exception):
        raise ValueError('Hook 输入读取失败') from raw
    data = json.loads(raw) if raw.strip() else {}
    if not isinstance(data, dict):
        raise ValueError('Hook 输入必须是 JSON 对象')
    return data


def contained(root, path):
    resolved = path.resolve()
    if not resolved.is_relative_to(root):
        raise ValueError('Trellis 资料路径越过仓库边界')
    return resolved


def read_object(root, path):
    data = json.loads(contained(root, path).read_text(encoding='utf-8'))
    if not isinstance(data, dict):
        raise ValueError('Trellis 状态文件必须是 JSON 对象')
    return data


def context(root, data, event):
    # 独立模块无相对导入；避免导入整个 CLI 包及其无关副作用。
    sys.path.insert(0, str(root / '.trellis/scripts/common'))
    from active_task import resolve_active_task, resolve_context_key, resolve_task_ref
    from trellis_config import read_trellis_config
    config = read_trellis_config(root)
    section = config.get('prompt_injection', {})
    keyword = section.get('skip_keyword', 'no-trellis') if isinstance(section, dict) else 'no-trellis'
    prompt = data.get('prompt', '')
    if event == 'UserPromptSubmit' and isinstance(keyword, str) and keyword and isinstance(prompt, str):
        if re.search(r'(?<![\w-])' + re.escape(keyword) + r'(?![\w-])', prompt, re.I):
            return None
    # 宿主 payload 是此次事件的身份来源；不借用父进程环境或唯一其他窗口。
    key = resolve_context_key(data, platform='codex', allow_environment_context=False)
    if not key:
        return {'status': 'unknown_session'}
    session_file = root / '.trellis/.runtime/sessions' / (key + '.json')
    if session_file.exists():
        session = read_object(root, session_file)
        if session.get('current_task') is not None and not isinstance(session['current_task'], str):
            raise ValueError('current_task 必须是字符串或 null')
    active = resolve_active_task(root, data, platform='codex',
        allow_single_session_fallback=False, allow_environment_context=False)
    result = {'status': 'no_task'}
    if not active.task_path:
        return result
    task = resolve_task_ref(active.task_path, root)
    if task is None:
        raise ValueError('活动任务路径越过仓库边界')
    contained(root, task)
    if active.stale:
        return {'status': 'stale_task', 'task_path': str(task)}
    metadata = read_object(root, task / 'task.json')
    status = metadata.get('status')
    if status not in ('planning', 'in_progress', 'completed'):
        raise ValueError('task.json 包含未知任务状态')
    result = {'status': status, 'task_path': str(task)}
    role = data.get('agent_type') or data.get('agentType')
    names = ('prd.md', 'design.md', 'implement.md')
    if event == 'SubagentStart':
        names = {'trellis-implement': ('implement.jsonl', *names),
                 'trellis-check': ('check.jsonl', *names),
                 'trellis-research': ('research/',)}[role]
    result['artifacts'] = [str(contained(root, task / name)) for name in names if (task / name).exists()]
    return result


def main(event):
    if os.environ.get('TRELLIS_HOOKS') == '0' or os.environ.get('TRELLIS_DISABLE_HOOKS') == '1':
        return 0
    try:
        data = read_input()
        if event == 'SubagentStart' and (data.get('agent_type') or data.get('agentType')) not in (
            'trellis-implement', 'trellis-check', 'trellis-research'):
            return 0
        # 脚本安装位置拥有仓库身份；只接受同仓库的 payload cwd。
        root = Path(__file__).resolve().parents[2]
        if not (root / '.trellis').is_dir():
            return 0
        cwd = data.get('cwd') or str(root)
        if not isinstance(cwd, str):
            raise ValueError('cwd 必须是字符串')
        contained(root, Path(cwd))
        state = context(root, data, event)
        if state is None:
            return 0
        print(json.dumps({'hookSpecificOutput': {'hookEventName': event,
            'additionalContext': '<trellis-state>\n' + json.dumps(state, ensure_ascii=False) + '\n</trellis-state>'}}, ensure_ascii=False))
        return 0
    except (OSError, ValueError, ImportError, TypeError) as exc:
        print('Trellis Hook 失败：' + str(exc), file=sys.stderr)
        return 1
