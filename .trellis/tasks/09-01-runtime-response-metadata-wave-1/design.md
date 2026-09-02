# 运行时 Response Metadata Wave 1 设计

## 1. 目标不变量与数据流

```text
Phase B final authority matrix（审计证据）
                 │
                 └─ contracts/openapi.yaml（只读冻结 authority）
                                      │
route 显式 status + 共享 wire schema ─┴─ compare_response_contracts()
                                      │
                                      └─ Wave 1 的 61 个 operation 零差异
```

本 Task 只修正声明层。实际行为 owner 仍是现有 route dependency、permission/CSRF、service command、exception handler 与 Response 对象；OpenAPI metadata 不反向驱动这些 owner。

最小行为差距是：Wave 1 的实际 HTTP 行为已由 Phase B 冻结，但 FastAPI route decorator 仍主要只有 success 与自动 `HTTPValidationError` 422 metadata。修正点位于共享 ErrorEnvelope schema/metadata owner 与 6 个 route owner 文件，不位于 service、dependency 或合同文件。

## 2. 文件边界

预期生产文件：

- `backend/app/schemas/common.py`：唯一 `ErrorEnvelope`/内部错误字段 wire model。
- `backend/app/errors.py`：handler 复用 wire model；提供只复用 schema/description 的 response metadata helper。
- `backend/app/main.py`：foundation health metadata。
- `backend/app/routers/configuration.py`：39 个 configuration operation metadata与 CSV 声明。
- `backend/app/routers/identity.py`：15 个 identity operation metadata 与 CSV 声明。
- `backend/app/routers/files.py`：5 个 files operation metadata。

预期测试文件：

- 新建 `backend/tests/unit/test_runtime_response_metadata.py`，集中拥有 Wave 1 的 61-operation inventory、domain projection、comparator parity、422/ErrorEnvelope、health/5xx/CSV metadata 断言，避免继续扩大 1675 行的 `test_contract.py` 或 916 行的 comparator mutation suite。
- `backend/tests/unit/test_contract.py` 原有 HTTP/service sentinels 作为 required regression；只有证据表明当前断言无法锁定 behavior-preserving refactor 时才做最小更新，不把 Wave 1 inventory 再复制一份。
- `backend/tests/unit/test_contract_check.py` 原有 comparator/FastAPI 自动 422 测试作为 required regression；不修改 production comparator，不在该文件增加 Wave filter。

禁止文件：`contracts/openapi.yaml`、generated client、`backend/app/services/**`、`backend/app/deps.py`、database、frontend、Makefile、CI，以及 Phase D/E/X/F owner。

### 2.1 Authority repair 恢复边界

首次实施暴露出的 success `schema_drift` 实际源于冻结合同中不可满足的 closed-base `allOf`。前置 `09-02-response-schema-composition-authority-repair` 已在 `7be5b979` 一次性修正全部相关 authority，并恢复默认 Pydantic 展平、closed schema owner。因此 Wave 1 只消费该结果：不得修改 `schemas/configuration.py` 的 composition，不得恢复 custom hook、私有 handler、硬编码 ref 或旧 `allOf` 测试。现存该文件的未提交格式差异不属于 Wave 1 交付，保持原样且不纳入提交。

## 3. 唯一 ErrorEnvelope owner

运行时模型保持既有 wire 层级：

```text
ErrorEnvelope
└── error
    ├── code: str           required
    ├── message: str        required
    ├── details: dict       required，handler 未提供时仍为 {}
    └── request_id: str     required
```

设计约束：

1. model 放在 `app.schemas.common`，继续使用 `ContractModel(extra="forbid")`。
2. `details` 在 JSON Schema 中必须同时保持 required 与 `default: {}` 的冻结机器语义；不得用带 Python 默认值的声明意外把它变为 optional。实现前用 Pydantic 2.13.4 的实际 `model_json_schema()` 验证。
3. `error_response()` 用该 model 形成 JSON content，输出仍与当前 dict 完全等价。`AppError`、handler 注册、status_code、message、details normalization、request_id fallback 都不改变。
4. 不新增 `DomainError`、错误 registry、status-to-code table、异常 subclass 或 service-side mapping；唯一变化是让真实 handler 与 OpenAPI schema 共享 wire model。

## 4. Metadata helper 边界

`app.errors` 提供一个小型 helper，输入由 route 明确列出的 status codes，输出 FastAPI `responses` mapping。helper 只负责：

- 为每个传入 status 绑定同一个 `ErrorEnvelope` model；
- 复用稳定、非业务推断性的 description；
- 返回新 mapping，避免 route 间共享可变 dict。

helper 不得根据 method/router/dependency/service 推断 status，不得内置“常见错误”默认集合，不得自动附加 422 或任何 4xx/5xx，不得读取冻结合同或 final matrix，也不得改写实际 exception/error-domain mapping。route decorator 必须直观看到每个 operation 的 status 列表，特殊 5xx 也只能由对应 operation 显式传入。

## 5. 422 与实际校验行为

FastAPI 0.139.0 在 operation 有 path/query/header/cookie/body 校验且未显式声明 422/4XX/default 时生成 `HTTPValidationError`。本 Task 对 Phase B 标记为 validation-capable 的 53 个 operation 显式声明 422 ErrorEnvelope；对其余 8 个无校验入口的 operation 不声明 422。

这不会改变 Pydantic request parsing、dependency 执行顺序、`RequestValidationError` 的产生、`validation_error_handler()` 返回的 422 `VALIDATION_ERROR`/字段 `loc`，也不会改变 route/service 是否执行。测试同时比较 metadata 和现有 TestClient 行为，防止“schema 对齐但实际校验被改”的假绿。

## 6. Health、CSV 与特殊 5xx

- `getLiveHealth` 保持 200，不添加猜测错误响应。
- `getReadyHealth` 显式声明 503 ErrorEnvelope，readiness probe 与 catch 边界不变。
- `exportUsers`、`exportPlatformProfiles` 使用适合现有原始 `Response` 返回的 response class/metadata 组合，确保 OpenAPI 200 只出现 `text/csv` string；显式声明 required string `Content-Disposition`，不重复声明 `Content-Type`。
- `discoverAIChannelModels` 显式包含 502/504；`createPlatformLogoCandidate` 与 `completeFileUpload` 显式包含 503；`testAIModel` 只保留矩阵状态，不恢复被 command 转换为 200 的 502/504。

## 7. Operation 验收矩阵

本 Task 的逐 operation source of acceptance 是 `research/wave-1-operation-ownership.md` 的 61 行表。该表从 Phase B final matrix 原样提取 `method/path/operationId/phase_b_statuses`，并按实际 router owner 分组；实现和 review 必须逐行检查，不允许用“同类路由”代表未检查 operation。

验收算法：

1. 测试冻结精确 61 个 operationId 与分组计数 2/39/15/5。
2. 从完整冻结 document 与完整 runtime document 各自只投影这些 operation，保留各自 components。
3. 对两个独立投影调用 Phase A 的 `compare_response_contracts()`；必须返回 `[]`。
4. 额外逐 operation 断言：冻结有 422 则 runtime 422 解析为项目 ErrorEnvelope；冻结无 422 则 runtime 无 422。
5. 单独断言 health、特殊 5xx、CSV media/Header，以提供比通用 pointer 更直接的失败信息。

test-only projection 只存在于测试，不进入 comparator/production，不接收 CLI filter，不被保存为 baseline。冻结合同仍是产品 authority；research matrix 只用于人工实施/review 逐行核对。

## 8. 兼容性、回滚与文档

不存在 API 或 generated client 变更；这是 runtime metadata 向已修正并冻结的公共合同收敛。若 implementation 发现必须继续修改 schema authority、frozen contract、service、permission、transaction、状态转换、actual error mapping，或必须改变模型 validation/serialization 才能清零，立即停止并回父 Task/独立业务 Task，不在本 Task 兼容处理。

回滚按 owner 原子进行：先回滚三个 router/main 的 decorator metadata，再在无其他 Wave 使用时回滚共享 helper/model；如果 ErrorEnvelope handler 序列化 refactor 有任何 wire diff，优先恢复 handler 调用并保留诊断，不用第二套模型兜底。

不更新 `contracts/openapi.yaml`、generated client、`contracts/database.md` 或 `.trellis/spec/`：本 Task 执行 Phase B 冻结合同和既有错误处理规范，没有新公共事实或数据库行为。若实施/Review 发现可复用的新稳定约束，再在 Phase 3.3 单独判断是否更新 spec。

## 9. 后续依赖

- 硬前置：Phase A comparator 可用；Phase B final matrix 的 status authority 未变；schema composition 已由 `7be5b979` 修正并由 `7f3b789b` 归档。恢复审计必须确认 61 行 method/path/operationId/status 仍与当前合同一致。
- Phase D/E 可以复用本 Task 建立的 ErrorEnvelope/helper，但只有本 Task 的 61-operation parity 与独立 review 通过后开始；后续 Wave 仍必须显式传入自己的逐 operation status。
- Phase X 在 C/D/E 完成后同步全局 `X-Request-ID`/400/Header，不得提前塞入本 Task helper。
- Phase F 仅在 B/C/D/E/X 全量零差异后启用完整默认 gate。
- `integrity-error-domain-mapping` 与本 Task 无依赖，不得借本 Task 修改。
