# 运行时响应元数据 Wave 2 设计

## 1. 目标不变量与权威流

```text
Phase B final matrix（逐 operation status/owner 审计证据）
                         │
                         └─ contracts/openapi.yaml（只读公共 authority）
                                              │
三个 route owner 显式 status + Wave 1 helper ─┴─ compare_response_contracts()
                                              │
                                              ├─ Wave 2：58 operation 零差异
                                              └─ Wave 1：61 operation 保持零差异
```

本 Task 只改变 FastAPI 文档生成所需的 route decorator metadata。实际请求仍按现有依赖、Pydantic 输入解析、route/service command、事务与异常 handler 执行；metadata 不反向驱动运行时行为。

最小 gap 已定位为：58 个 operation 的 success metadata 已正确，但 runtime 缺少 201 个明确错误 status，且 57 个自动 422 错误 schema 是 `HTTPValidationError`。权威 owner 是三个 router 的 decorator，不是 service、共享 error handler、冻结合同加载器或 comparator。

## 2. 精确文件边界

生产文件仅 3 个：

- `backend/app/routers/product_facts.py`：18 个 operation。
- `backend/app/routers/planning.py`：19 个 operation。
- `backend/app/routers/production.py`：21 个 operation。

测试文件：

- `backend/tests/unit/test_runtime_response_metadata.py`：扩展 Wave 1 已建立的 inventory/projection/comparator 测试，使其同时拥有 Wave 2 的 58-operation 验收。
- `backend/tests/unit/test_contract.py`：默认不修改；复用既有 HTTP sentinel。只有实施证明确有 behavior gap 时，才在同文件补一个最小 sentinel，并先说明原因。

明确禁止修改 `backend/app/errors.py`、`backend/app/schemas/common.py`、`backend/app/tools/contract_check.py`、`contracts/openapi.yaml`、generated client、services/deps、Phase E/X/F owner。

## 3. Decorator 同步方案

三个 router 直接 import Wave 1 已建立的 `error_responses`。每个 route decorator新增：

```python
responses=error_responses(<该 operation 的明确错误 status...>)
```

设计约束：

1. 只传非 success status；现有 `response_model`、`status_code` 与 FastAPI 默认 success metadata 保持 owner。
2. 参数顺序按数值升序，方便逐 operation review；该顺序不代替集合验收。
3. `listQueryTopics` 精确为 `error_responses(401, 403)`，不含 422。
4. 其余 57 个 operation 显式包含 422，因此 FastAPI 不再生成 `HTTPValidationError` metadata，而是使用项目 `ErrorEnvelope`。
5. 404/409 只按 ownership matrix 的实际逃逸路径列出；Wave 2 不列任何 5xx。
6. 不建立 `PRODUCT_ERRORS`、`CONTENT_ERRORS`、`COMMON_ERRORS` 或按 GET/POST/DELETE 的共享 status tuple；status 必须在 decorator 处可直接审查。

## 4. Success、media 与 Header 保持

Wave 2 的 success authority 已一致，不需要 `responses` 中重述 success：

- 42 个 200、7 个 201、3 个 202：保留现有 `response_model` 生成的 `application/json` schema。
- 6 个 204：保留 no-body，不得因合并 mapping 添加 content/model。
- operation-specific response Header 全部为空；不得提前加入 Phase X 的 `X-Request-ID`。

`error_responses()` 只为明确错误 status 生成 `application/json` ErrorEnvelope。它不会覆盖 success response，也不会改变实际 Response object。

## 5. 422 分界与行为不变

FastAPI 0.139.0 当前为 57 个 validation-capable route 自动生成 422 `HTTPValidationError`。同步后 decorator 显式声明同一 422 status 的项目 ErrorEnvelope；实际 `RequestValidationError` 仍由 FastAPI/Pydantic 产生，并由现有 `validation_error_handler()` 编码。

唯一 validation-free operation `listQueryTopics` 当前没有自动 422，目标也没有 422。不得通过宽 `4XX/default` 抑制生成器，也不得给它增加虚构 422。

既有 TestClient sentinel 锁定匿名/权限/CSRF、path/query/body validation 与 ErrorEnvelope；PostgreSQL integration owner 锁定 service、事务和状态转换。本 Task 不修改这些 owner。

## 6. 测试设计

### 6.1 完整 inventory

在现有测试文件新增 `WAVE_2_OPERATION_IDS` 与 `WAVE_2_GROUPS`，精确冻结：

- `product_facts=18`
- `planning=19`
- `production=21`
- 合计 58 且 identity 唯一

测试同时证明这些 operationId 均存在于冻结/runtime document。operationId 清单不得从 research 或 matrix 在测试运行时加载。

### 6.2 复用 test-only projection

把现有只绑定 Wave 1 常量的 `_wave_projection()` 做最小 test-only 参数化，使调用方显式传入 operation id 集合；不修改 production comparator。分别执行：

- Wave 1 projection：61 个 operation，`compare_response_contracts() == []`。
- Wave 2 projection：58 个 operation，`compare_response_contracts() == []`。

不得把两波合并后只断言总集，以免一个 wave 的遗漏被另一波掩盖；也不得按 failure kind 过滤。

### 6.3 逐 operation 验收

对 Wave 2 全部 58 个 operation：

- runtime status set 精确等于冻结合同；
- 冻结含 422时，runtime 422 schema ref 精确为 `ErrorEnvelope`；冻结无 422时 runtime 不含 422；
- 每个 401/403/404/409/422 runtime response 均使用 ErrorEnvelope；
- 额外直接断言 7×201、3×202、6×204/no-body、无 5xx、无 operation-specific Header。

Wave 1 现有 health/CSV/特殊 5xx 与单一 ErrorEnvelope schema 断言保留并回归。

## 7. 行为 sentinel 与验证层级

Required 轻量 TestClient sentinels：

- Query Topic 删除的 anonymous/admin/CSRF 拒绝；
- Product 删除的 revision query 422；
- Content revision 与 draft update 的 body validation 422。

它们直接经过本次修改的 router 和共享 handler，能证明 metadata 添加未改变依赖/校验/error envelope。现有 PostgreSQL integration tests 作为 optional 深度回归，覆盖产品/事实审核、Query Topic revision、内容任务 idempotency、归档/永久删除、草稿 parent pointer、内容审核不可变状态和 generation reliability。

如果 implementation diff 触及 service/dependency/schema/helper，或轻量 sentinel 显示实际行为变化，立即停止并回到 planning；不通过扩大测试来授权越界改动。

## 8. 兼容性与文档

- 公共 API/生成类型不变：runtime metadata 收敛至已冻结合同。
- 实际 HTTP 行为不变：错误状态本已由 dependency/route/service/handler 产生，本 Task 只让 runtime OpenAPI 宣告它们。
- 不更新合同、generated client、数据库合同或业务设计文档；没有新的公共事实。
- 不预计更新 backend spec；实现只是应用 Wave 1 已固化的规范。

## 9. 依赖顺序

```text
Phase A comparator
   ↓
Phase B frozen authority + composition authority repair
   ↓
Phase C / Wave 1（已完成，提供唯一 ErrorEnvelope/helper）
   ↓
Phase D / Wave 2（本 Task）
   ↓
Phase E / Wave 3（publication/GEO/workbench）
   ↓
Phase X（全局 X-Request-ID request/400/response Header）
   ↓
Phase F（默认完整 response gate 激活）
```

Phase E 只能在 Wave 2 domain-zero 与独立 Review 通过后开始。Phase X 依赖 C/D/E 全部完成；Phase F 依赖 B/C/D/E/X 全量无过滤 report 零差异。

## 10. 回滚边界

- 本 Task 的 route metadata 可按 `product_facts → planning → production` owner 原子回滚；每次回滚后 Wave 2 parity 应再次变红，不能用 filter 维持假绿。
- 测试 inventory/projection 与三个 router 同批回滚；不回滚 Wave 1 的 ErrorEnvelope/helper。
- 后续 Phase 已依赖 Wave 2 时优先 roll-forward；确需回退按 `F → X → E → D` 逆序。
- 回滚不得触碰实际 service、权限、事务、状态转换、合同/generated 或既有脏 artifacts。

## 11. 反方案

- 不使用全 router 公共 status 模板：58 个 operation 的 404/409/422 分界不同。
- 不读取冻结合同在 runtime 动态注入 `responses`：会让比较双方失去独立性。
- 不使用 `4XX/default` 抑制自动 422：会降低合同精度并掩盖 ErrorEnvelope schema。
- 不修改 shared helper/schema：当前 owner 已满足需求，无证据支持重构。
- 不把全局 report 的剩余 Phase E/X 漂移保存为 baseline/allowlist。
