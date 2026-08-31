# 完整 Response Comparator 核心实施计划

## Scope

只修改两个文件：

- `backend/app/tools/contract_check.py`
- `backend/tests/unit/test_contract_check.py`（新建）

实施前完整阅读 checker 与现有 `backend/tests/unit/test_contract.py` 中相关调用/断言；不得修改后者或其他生产文件。

## Implementation Checklist

1. 纯比较基础
   - [x] 将 response 比较实现为不读文件、不 import app、不修改输入的 document-level pure API。
   - [x] 复用现有 operation identity；不改变 request/security 检查。
   - [x] 建立稳定 failure 数据/格式与 RFC 6901 pointer helper。
2. status 与 response
   - [x] 实现严格 status normalization、碰撞检测和完整集合比较。
   - [x] 实现 response ref、content/media/schema presence、no-body protocol validation。
   - [x] 实现 Header Object ref、大小写碰撞、schema/content 与序列化字段比较。
3. schema
   - [x] 实现 local ref graph safety、object/array/scalar 递归机器 shape。
   - [x] 实现安全 allOf、anyOf、保留 multiplicity 的 oneOf 与 OpenAPI 3.1 null union。
   - [x] annotation allowlist 与未知机器字段/links fail-closed。
4. CLI/report
   - [x] 明确解析可选 positional contract path。
   - [x] 增加无 filter/suppress/allowlist 的 `--response-report`，复用同一 pure API。
   - [x] 保持默认 `check()`、首个 2xx 旧路径和 `make contract-check` 行为不变。
5. Mutation tests
   - [x] status missing/extra、multi-2xx、non-2xx schema、204/no-body、body/media/schema presence。
   - [x] response/schema/header ref、pointer escape、坏/外部 ref、递归图。
   - [x] allOf/anyOf/oneOf/nullable、required/property/items/constraints、annotation/unsupported。
   - [x] header name collision、schema/content 互斥、serialization defaults。
   - [x] FastAPI 0.139.0 自动 422 条件及自定义 handler 不改变 metadata。
   - [x] CLI report 非零、稳定输出和默认 gate 未提前切换。
6. Review
   - [x] `trellis-check` 独立审查假绿路径、递归/组合语义和 mutation tests 是否真正改变输入而非复制实现。
   - [x] 主代理检查实际 diff 仅包含两个授权文件及 Task 记录。

## Required Validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract_check.py
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/tools/contract_check.py backend/tests/unit/test_contract_check.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml \
  backend/app/tools/contract_check.py
make contract-check
```

当前 live drift report 的预期验证：

```bash
set +e
UV_CACHE_DIR=.cache/uv uv run --project backend python -m app.tools.contract_check \
  --response-report contracts/openapi.yaml
response_report_rc=$?
set -e
test "$response_report_rc" -eq 1
```

报告内容必须包含当前完整 drift；本 Task 不保存可被 checker 读取的 baseline。

## Optional Validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit
```

不运行 frontend tests/build、数据库 integration、Playwright 或生产调用：授权文件只涉及 backend 纯合同工具和 unit tests。若实际 diff 触及 FastAPI app/router/schema 或公共合同，立即停止并退回父任务，而不是扩大验证或范围。

## Rollback

- 删除新 pure comparator/report 入口及聚焦测试即可恢复 Phase A 前状态。
- 不允许通过恢复 ignored status、drift snapshot 或 frozen-contract overlay 回滚失败。
- 默认 gate 若意外开始报告现有 156 个 status drift，视为越界；恢复默认旧路径并保留 report 入口。

## Pre-implementation Gate

- [x] 父规划已经人工批准。
- [x] 用户明确同意只创建并启动 Phase A 子任务。
- [x] 本 Task 不修改公共合同或 runtime metadata。
- [x] `implement.jsonl` / `check.jsonl` 已配置并通过 `task.py validate`。
- [x] `task.py start` 成功，Task status 为 `in_progress`。
