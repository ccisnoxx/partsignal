# 运行时响应元数据 Wave 2

## Goal

让 `product_facts`、`planning`、`production` 三个 FastAPI router 的 runtime response metadata 与 Phase B 已冻结并经 schema composition authority repair 修正的逐 operation 公共合同一致，同时保持实际 HTTP status、body、Header、权限、校验、事务、状态转换和 error-domain mapping 不变。

本 Task 是父任务 `08-31-non-2xx-contract-check` 的 Phase D，只拥有一个可独立 review 的目标：收敛 Wave 2 的 58 个 operation。实施、required validation 与独立只读 Review 已完成；当前仅修正尚未 push 的工作提交范围，修正后继续保持 `in_progress`，不归档、不记录 session journal，也不开始 Phase E。

## Confirmed Facts

- Phase A 已提供纯 `compare_response_contracts()` 与无 filter 的 `--response-report`；默认完整 response gate 尚未启用。
- Phase B final matrix 包含 162 个 operation，并已冻结逐 operation status 与实际 owner；后续 authority repair 只修正 response schema composition，不改变这些 status。
- 从当前实际注册的三个 `APIRouter` 与 `app.openapi()` 联结 Phase B matrix，Wave 2 精确为 58 个唯一 operation：`product_facts=18`、`planning=19`、`production=21`。
- Wave 2 status occurrence 为：`200=42`、`201=7`、`202=3`、`204=6`、`401=58`、`403=58`、`404=50`、`409=35`、`422=57`。唯一不含 422 的 operation 是 `listQueryTopics`。
- 当前 Wave 2 runtime 投影与冻结合同有 258 条 comparator failure：201 条 `missing_status`（401×58、403×58、404×50、409×35）和 57 条 422 schema drift；全部 57 个 runtime 422 当前由 FastAPI 自动指向 `HTTPValidationError`。
- 当前未发现 Wave 2 success response 的 status、media、schema 或 operation-specific Header 漂移；42 个 200、7 个 201、3 个 202 均为既有 JSON response model，6 个 204 均为 no-body。Wave 2 没有 CSV、operation-specific response Header 或特殊 5xx。
- Wave 1 已建立唯一 `ErrorEnvelope` 与 `error_responses(*status_codes)` helper。helper 只绑定同一个 error schema/description，调用方显式提供 status；可直接复用，不需要修改 `backend/app/errors.py` 或 `backend/app/schemas/common.py`。
- 完整逐 operation method/path/operationId/status/422/success shape/特殊 owner 见 `research/wave-2-operation-ownership.md`。该文件只作 planning/review 证据，不得成为 production input、baseline 或 allowlist。
- 工作区在 `main`，规划开始时有 545 项既有未提交变化；目标三个 router、共享 helper/schema、冻结合同、generated client 和聚焦测试当时均无额外 dirty diff。所有既有脏文件和 artifacts 都属于本 Task 外部状态，不得恢复、删除、格式化、暂存或提交。

## Requirements

1. 只在 `backend/app/routers/product_facts.py`、`backend/app/routers/planning.py`、`backend/app/routers/production.py` 为全部 58 个 operation 同步 route decorator response metadata；每个 operation 的 status 必须由该 decorator 显式传给既有 `error_responses()`。
2. status 只能来自 Phase B `final-response-authority-matrix.jsonl` 的 `phase_b_statuses`，不得从当前 runtime metadata、HTTP method、依赖类型、相邻 route 或同 router 模板猜测。
3. 57 个 validation-capable operation 必须显式声明 422 项目 `ErrorEnvelope`；`listQueryTopics` 必须保持无 422，且不得用 `4XX`、`default` 或其他宽响应抑制 FastAPI 自动 metadata。
4. 必须保留全部成功差异：7 个 201、3 个 202、6 个 204 no-body 与其余 200；不得按 POST/DELETE 批量推断或改变 success model/media/Header。
5. Wave 2 没有特殊 5xx；不得因 Wave 1 存在 502/503/504 而向本 Wave 复制。401/403/404/409/422 的 owner 必须与 ownership matrix 一致。
6. 直接复用 Wave 1 的唯一 `ErrorEnvelope` 与 `error_responses()`；不重构 `backend/app/errors.py`、`backend/app/schemas/common.py`，不新增状态模板、第二错误层级、registry、overlay 或兼容 fallback。
7. 扩展 `backend/tests/unit/test_runtime_response_metadata.py`，冻结完整 Wave 2 operation inventory 与 18/19/21 分组，逐 operation 核对精确 status set、422 `ErrorEnvelope`/无 422 分界，并对 Wave 2 投影直接调用 `compare_response_contracts()` 断言完整 failure list为 `[]`。
8. Required validation 必须同时回归 Wave 1 的 61 个 operation，证明共享 ErrorEnvelope/helper、health、CSV 和 Wave 1 特殊 5xx 未被破坏。
9. 保留既有 HTTP/service/integration sentinels；只在真实 behavior gap 存在时补最小 TestClient sentinel。metadata coverage 不通过为 58 个 operation 机械复制 58 个 E2E。
10. 无 filter 的全局 `--response-report` 在 Phase E 与 Phase X 尚未完成时预期返回 1；不得加入 baseline、allowlist、production filter、overlay 或 ignored operation/status/path。退出 2 必须阻断；退出 0 必须先审计是否越界提前完成后续 Phase。
11. 不修改实际 service、permission、CSRF、transaction、状态转换、error code、异常 escape/transform 或实际 HTTP status/body/Header。
12. 不修改 `contracts/openapi.yaml`、frontend generated client、response schema composition authority、Phase E/X/F owner、Makefile、CI、数据库或生产数据。

## Acceptance Criteria

- [x] Wave 2 inventory 精确为 58 个唯一 operation：`product_facts=18`、`planning=19`、`production=21`；method/path/operationId 与真实注册结果和 Phase B matrix 一致。
- [x] 全部 58 个 operation 的 runtime response status set 与 Phase B `phase_b_statuses` 精确相等；保留 200/201/202/204 的逐 operation 差异。
- [x] 57 个 422 都指向项目 `#/components/schemas/ErrorEnvelope`；`listQueryTopics` 无 422、`4XX`、`default` 或 `HTTPValidationError`。
- [x] 所有 runtime error response 使用唯一 ErrorEnvelope；共享 helper 没有默认/推断状态集合，每个 decorator 清楚列出自身 status。
- [x] Wave 2 success response 的 JSON schema/no-body、media 和 operation-specific Header 与冻结合同一致；本 Task 不新增 5xx 或 Header。
- [x] 对冻结合同与 runtime 的完整 Wave 2 投影调用 `compare_response_contracts()` 返回 `[]`，不按 failure kind 过滤、不抽样。
- [x] Wave 1 的 61-operation inventory、status、422/ErrorEnvelope、health、CSV 与特殊 5xx 回归全部通过。
- [x] 既有 HTTP behavior sentinels继续证明权限/CSRF、输入校验、错误信封、产品/事实审核、Query Topic revision、内容任务创建/归档/永久删除、草稿与审核状态转换和事务语义未改变；如未补测试，closeout 明确依据是 metadata-only diff 加这些既有 sentinel。
- [x] 无 filter 的全局 response report 精确记录退出码；预期为 1 且只剩 Phase E/X 差异，不保存 baseline 或 allowlist。
- [x] diff 只包含三个授权 production router、聚焦测试与本 Task artifacts；共享 owner、合同、generated client、service/permission/transaction/state/error mapping 和无关 dirty artifacts 均无 Task diff。
- [x] required validation 全部通过；独立只读 Review 无漏 operation、猜测 status、行为变化、共享 owner 重构或 Phase E/X/F 越界。

## Out of Scope

- `contracts/openapi.yaml`、frontend generated client 与 response schema composition authority 的再次修改。
- `backend/app/errors.py`、`backend/app/schemas/common.py` 等 Wave 1 共享 owner 的无证据重构。
- service、dependency、permission、CSRF、transaction、状态转换、实际 error-domain mapping、实际 HTTP status/body/Header。
- Phase E：publication/GEO/workbench runtime metadata。
- Phase X：`X-Request-ID` request/response Header 与非法值 400、login/logout 多实例 Cookie sentinel。
- Phase F：默认完整 response gate 激活。
- `integrity-error-domain-mapping`、frontend 实现/视觉、数据库 migration、生产调用/数据写入、无关重构。

## Documentation and Contract Impact

- `contracts/openapi.yaml` 不修改：Phase B 已冻结本 Task 的目标 status/schema/media/Header，且 authority repair 已修正 composition；本 Task 只让 runtime metadata 向该只读 authority 收敛。
- frontend generated client 不修改：公共合同字节不变，重新生成不会产生合法 Task diff。
- `contracts/database.md` 与业务设计文档不修改：没有数据模型、业务规则、权限或状态转换变化。
- `.trellis/spec/` 预计不修改：本 Task 直接执行现有“逐 operation 显式 status、唯一 ErrorEnvelope/helper”规范；只有实施/Review 发现新的稳定约束时才在 Phase 3.3 另行判断。

## Execution and Review State

本版 planning artifacts 已获批准，Phase 2 实施、required validation 与一次独立只读 Review 均已完成，实际结果记录在 `research/validation-results.md`。提交范围修正只更新 Task 状态并重建提交树，不改变四个产品/测试 blob；修正后仍不归档、不记录 session journal、不 push，也不开始 Phase E。
