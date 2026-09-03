# Response comparator HTTP 方法覆盖修复

## Goal

让默认完整 response 合同门禁覆盖 OpenAPI 3.1 的全部八种 Operation Object HTTP 方法，消除静态合同或 runtime 单侧缺失 `HEAD`、`OPTIONS`、`TRACE` operation 时仍返回成功的 false-green。

## Background

- `backend/app/tools/contract_check.py` 的 `HTTP_METHODS` 当前只有 `get/post/put/patch/delete`，`operation_map()` 会跳过其他方法。
- `backend/app/main.py` 的 runtime metadata owner 已覆盖 `get/put/post/delete/options/head/patch/trace`；checker 与 runtime owner 的方法集合不一致。
- 已观察最小反例：合同包含 `HEAD /probe`、runtime `paths` 为空时，双方 `operation_map` 均为空，完整 comparator 没有报告 `missing_operation`。
- 当前 162 个 operation 恰好都使用既有五种方法，因此现有 static/runtime 零漂移证据不能覆盖该缺口。

## Requirements

- checker 的 operation 枚举必须覆盖 `get`、`put`、`post`、`delete`、`options`、`head`、`patch`、`trace`。
- `HEAD`、`OPTIONS` 或 `TRACE` operation 仅存在于合同或 runtime 一侧时，默认 `check()` 必须通过完整 comparator 报告稳定的 `missing_operation` 或 `extra_operation`，不得增加 filter、allowlist、baseline 或兼容开关。
- Path Item 的非 operation 固定字段及 extension 继续不被当作 operation；不得破坏共享 `parameters` 合并和现有 `paths.x-*` 处理。
- 继续由唯一 `compare_response_contracts()` 拥有 operation/status 漂移；不得恢复旧 path 重复诊断、首个 2xx shortcut 或 `--response-report`。
- 不改变 FastAPI runtime OpenAPI、公共合同、generated client、业务 HTTP 行为、CORS、权限、事务、状态转换或错误映射。
- 产品实现只修改 checker 与其定向单元测试；Phase 3.3 同步既有 backend error-handling spec 的八种 operation 方法与回归要求，不修改其他测试或 runtime owner。

## Acceptance Criteria

- [x] 默认 `check()` 对合同独有的 `HEAD`、`OPTIONS`、`TRACE` operation 分别返回 `missing_operation`，pointer 和 direction 准确。
- [x] comparator 对 runtime 独有的上述方法仍返回 `extra_operation`；测试没有只调用复制实现的辅助逻辑。
- [x] 现有五种方法、Path Item shared parameters、非 operation 固定字段和 `paths.x-*` extension 行为不回归。
- [x] `backend/tests/unit/test_contract_check.py` 通过。
- [x] `test_runtime_openapi_matches_frozen_operations` 通过，当前 162-operation 快照保持零漂移。
- [x] Ruff 定向检查和 `make contract-check` 通过。
- [x] 稳定 backend error-handling spec 明确八种 operation 方法及对应默认门禁回归要求。
- [x] 独立 `trellis-check`/release-gate Review 无未解决的 MEDIUM+ finding。
- [x] 工作提交候选只包含本 Task 的 checker、定向测试、backend error-handling spec 和 Trellis task 文件，不包含现有任务外 dirty/index 内容。

## Out of Scope

- 新增真实 `HEAD`、`OPTIONS`、`TRACE` API endpoint。
- 修改 `contracts/openapi.yaml`、runtime metadata、generated client 或 CORS allow-methods。
- 修改 response schema/status/header/media 比较语义。
- `integrity-error-domain-mapping` 或其他业务错误映射工作。
