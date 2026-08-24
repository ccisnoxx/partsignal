# A28 执行计划

## Phase 0 — 批准、前置与冻结

- 等待 recheck evidence 提交、A27 状态明确并回到 clean `main`。
- 冻结候选 SHA；用户批准后才 `task.py start` 和按授权创建临时分支。
- 使用 Trellis implement/check sub-agent；主会话保留最终范围和 commit 决策。

## Phase 1 — 受控基线

- 不输出 `.env` 或真实值；用唯一受控 marker 确认当前 Settings repr/error/failure-output 三个面。
- 只记录布尔、命中数量、Pydantic 版本和 owner。
- 若观察与 research 不同，先更新设计，不猜测 workaround。

## Phase 2 — 最小实现

- `SettingsConfigDict` 增加 `hide_input_in_errors=True`。
- 为 design 列出的七个字段增加 `repr=False`，保持 `str`、default、alias 和 validator 不变。
- 在现有 Settings unit owner 添加 marker regressions；不新增 helper framework。

## Phase 3 — Required validation

按由小到大运行：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_security_and_publication.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend
UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml backend/app
```

另运行受控 failure-output capture，要求 marker 命中数为 0。若命中，停止并保持 A28 open；不得修改 pytest 全局配置、Makefile 或 runner。

根 `make test-unit` 为可选 full-suite，仅在用户批准且环境 owner 已由 A27 明确时运行；不运行 E2E 或 `make verify`。

## Phase 4 — 自审与收口

- 搜索 Settings 所有敏感字段 caller，确认没有类型/行为变化。
- 复核 diff 只有 config、既有 unit owner、当前 Task/父 metadata；无 secret、fallback 或全局 scanner 声明。
- A28 通过才更新父 blocker 状态；Phase 8 继续 `NOT_MET`。
- 运行 `git diff --check`、Task validate、Git status；展示 commit plan并等待批准。

## Stop Conditions

- 前置 recheck/A27 未收口、候选不 clean、出现未识别 dirty 文件。
- 模型原生控制无法阻止受控 pytest failure output。
- 需要 `SecretStr` 类型迁移、pytest/Makefile/runner 全局变更或新增依赖。
- 任何测试失败与当前改动无关且无相关变化支持重跑。

## 建议 Commit 范围

`fix(backend): hide sensitive settings failure inputs`

- `backend/app/config.py`
- `backend/tests/unit/test_security_and_publication.py`（或研究确认的现有 Settings unit owner）
- 当前 A28 Task artifacts
- Phase 8 父 Task A28 metadata
- 不含 A27、E2E/Makefile/pytest 全局配置或 `07/08`

## 执行结果（2026-08-24）

- 固定候选：`deed51ddfc7430db93b4ff7035117c812335a604`。
- 实现：`SettingsConfigDict(hide_input_in_errors=True)`，七个既有敏感 `str` 字段增加 `repr=False`；alias、default、validator 与 caller 合同未变。
- 目标测试：18 passed，最终 exit 0。首次 pytest 已通过后外层 zsh 记录包装误用了只读变量名；仅在随后把子进程 cwd 改为与调用目录无关后，按相关变化重新验证一次。
- 完整 backend unit：204 passed，exit 0，6 秒。
- Ruff：exit 0；mypy：80 source files、0 issues、exit 0。
- 受控 failure output：预期非零退出，marker 命中 0，`input_value=` 不可见，具体中文原因可见。
- 未运行可选根 `make test-unit`、E2E 或 `make verify`；未修改 pytest 全局配置、Makefile、runner 或依赖。
- A28=`CLOSED`；父任务已无开放 blocker，但 Phase 8 Exit Gate 继续为 `NOT_MET`，等待用户批准新的独立 recheck。
