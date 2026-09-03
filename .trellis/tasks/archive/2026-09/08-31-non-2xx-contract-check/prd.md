# 完整 Response 合同门禁

## Goal

把 `backend/app/tools/contract_check.py` 从“只比较首个 2xx response”提升为覆盖每个 operation 完整 response status key 集合和机器可执行 response shape 的可靠合同门禁，使冻结 OpenAPI、FastAPI runtime OpenAPI 与已确认的实际 HTTP 行为可以独立互证，而不是比较同一来源与自身。

本 Task 是 `08-30-frontend-v2-functional-contract-conformance-baseline` 的 3E 独立后续 Task。最终实现已经由九个直属子任务分阶段完成；父任务本身只承担来源要求、依赖顺序、最终集成核对与归档，不再修改产品代码、OpenAPI、generated client、业务行为或生产数据。

## Final Integrated State

- Phase A、B、Composition Authority、三个 Runtime Metadata Wave、GEO Schema Identity、Phase X 与 Phase F 九个直属子任务均已归档为 `completed`，且 `parent` 均指向本 Task。
- Publication event-time authority 修复 `562d2bce` 与 response comparator HTTP method coverage 修复 `b2bc3c6` 是独立阻塞修复，不是本 Task 的直属 child；后者已归档为 `completed`，并关闭最终 Review 发现的 `HEAD`、`OPTIONS`、`TRACE` false-green。
- 最终门禁激活提交为 `000a0d27`，方法覆盖修复提交为 `b2bc3c6`。默认 `check()` 只调用唯一完整 response comparator；`successful_response()`、首个 2xx shortcut 与 `--response-report` 过渡入口均已删除。
- checker 覆盖 OpenAPI 3.1 八种 operation 方法；当前冻结合同与 runtime OpenAPI 均精确覆盖 162 个 operation、1023 个 response occurrence、162 个 `X-Request-ID` request Header、162 个显式 400 和 1023 个 required response `X-Request-ID` Header。
- login/logout 的多个 `Set-Cookie` 继续由 HTTP sentinel 逐 occurrence 保证，OpenAPI 未声明失真的单值 `Set-Cookie` Header。
- `contracts/openapi.yaml`、runtime `app.openapi()`、canonical generated client、相关测试、Makefile/CI 与稳定 specs 当前一致。`b2bc3c6` 只修改 checker、定向测试和既有 backend spec，没有改变公共合同、runtime metadata 或 generated client。
- 父任务没有改变既定业务 HTTP 行为、权限、事务、状态转换或数据库合同。

## Confirmed Baseline

- 冻结合同与 `app.openapi()` 各有 162 个 operation，path/method/operationId 集合一致。
- 156 个 operation 的 response status key 集合不一致，只有 6 个集合相等；集合相等也不等于 shape 或实际行为正确。
- 冻结合同有而 runtime metadata 缺失的状态出现次数为：401×125、403×115、404×88、409×97、502×2、503×2、504×2；runtime 自动生成而冻结合同缺失的 422 为 69 个 operation。
- 双方共有 80 个 422，但冻结合同指向项目 `ErrorEnvelope`，runtime 自动 metadata 指向 FastAPI `HTTPValidationError`；实际异常 handler 返回前者。
- 两个 CSV export 的冻结响应为 `text/csv` 且声明 `Content-Disposition`，runtime metadata 当前为 `application/json` 空 schema。
- 所有实际响应都由 middleware 写入 `X-Request-ID`；login/logout 还写入多个不可安全合并的 `Set-Cookie`。冻结合同与 runtime metadata 当前都未完整声明这些实际 Header，故“两份 OpenAPI 一致”本身不足以证明 Header 权威正确。
- 实际 `ErrorEnvelope.error` 始终包含 `details`，但冻结 `ErrorDetail.required` 当前不含该字段；这属于双方 metadata 同步前必须先修正的 wire authority 漂移。
- 完整成功 schema 归一化审计还发现 7 个 operation 差异：2 个 health nullable、2 个 GEO basis discriminator metadata、3 个 generation snapshot `oneOf`/`anyOf`。
- 当前冻结 status 集合也有明确缺口：至少漏 401×35、403×43、404×32、409×10，以及 `completeFileUpload` 的 503；`testAIModel` 冻结的 502/504 与实际“捕获后返回 200 失败投影”冲突。
- 详细差异与权威调用链分别见 `research/response-drift-classification.md` 和 `research/route-response-authority-audit.md`。156 个集合差异不得直接解释为 156 个业务实现错误。

## Requirements

1. 对每个共享 operation 比较规范化后的完整 response key 集合；status 只存在于一侧时必须失败，不得只比较首个 2xx、双方交集或某个错误子集。
2. 对双方共有的每个 status 比较 response body 存在性、完整 media type key 集合、每个 media 的 schema 存在性与递归机器 shape；多个 2xx 与所有非 2xx 使用同一比较路径。
3. response-level `$ref` 与 schema `$ref` 必须分别按各自文档展开；等价的 inline/ref 表达不得假失败，坏引用、外部引用或无法安全解释的循环/组合不得静默跳过。
4. schema 比较必须保留 nullability，递归覆盖 `$ref`、安全可展开的 `allOf`、`anyOf`、`oneOf`、nullable 表达、object properties/required、array items 和既有机器约束；annotation-only 差异不得制造噪声。
5. 双方均无 body 的 204 通过；任一侧给明确 no-body status 添加 content 时失败。不存在 schema、空 schema `{}` 与非空 schema 必须区分。
6. OpenAPI 可表达且经 authority audit 确认为稳定的 response headers 属于本 Task 的机器合同：至少包括全局 `X-Request-ID` 与两个 CSV 的 `Content-Disposition`，按大小写不敏感的 header name 集合和完整 Header Object 机器语义比较。login/logout 的多实例 `Set-Cookie` 无法由 OpenAPI Header Object 精确表达，不进入文档 parity；其既有行为由 HTTP sentinel 锁定，本 Task 不改变 Cookie 属性或数量。description、title、examples、`$comment` 等文档 annotation 不比较；links 当前为零，若未来出现则先显式报 unsupported，不能静默忽略。
7. error output 必须稳定、排序并使用 RFC 6901 JSON Pointer 精确定位 path、method、status、media/header、schema property/constraint，以及 `missing_in_contract` / `missing_in_runtime`。
8. authority reconciliation 以实际 HTTP 行为、route command、认证/权限/CSRF 依赖、明确 AppError/service 路径、middleware/Response Header 写入和现有行为测试为依据；`contracts/openapi.yaml` 与 runtime metadata 都不是无需核验的绝对事实。统一 ErrorEnvelope 的字段存在性和类型也必须由 handler 行为冻结，不能只让两份 schema 相互对齐。
9. 复用统一 `AppError`/`ErrorEnvelope` 运行时信封和 FastAPI route response metadata；不得新增第二套业务错误类型系统、统一给所有 operation 套猜测状态，或改变权限、状态转换、事务和错误映射。
10. 不得从冻结合同读取 responses 后覆盖 `app.openapi()`，不得引入 ignored operation/status/path allowlist、持久漂移 baseline、双方交集比较或默认 ErrorResponse 补全来制造一致。
11. 用 synthetic documents 和最小 FastAPI app 执行 mutation-style 回归，证明 missing/extra status、multi-2xx、非 2xx schema、body/media/header、204、response/schema/header ref、composition/nullable 漂移都会失败；额外覆盖 header name 碰撞、schema/content 互斥、`oneOf` 重复分支，并锁定 FastAPI 0.139.0 自动 422 条件。
12. CI 继续通过 `make contract-check` 调用同一最终门禁；frontend `api:check` 继续证明 generated client 与最终冻结合同一致。CI trigger 是否扩展到 push/PR 不属于本 Task。
13. 任何必须改变实际 HTTP 状态、业务 error code、权限或异常映射的发现必须拆为独立业务/合同 Task；3E 只建立并启用完整 response 合同门禁及其必要 metadata/冻结合同同步。

## Delivery History

156 个集合差异、现有合同遗漏、7 个成功 shape 差异与跨切面 400 没有压入一个实现 diff，而是由本 3E 集成父任务按以下可独立 review 的子任务顺序完成：

1. comparator core 与 mutation tests；阶段内不切换 live gate。
2. response authority reconciliation 与 schema composition authority repair：修正静态 OpenAPI、generated client、runtime schema owner 与局部合同测试，不改变实际 payload。
3. runtime response metadata 三个 domain wave：foundation/config/identity/files；product/content；publication/GEO/workbench。
4. GEO schema identity 与 Publication event-time authority 前置修复，关闭 Wave 3 的 success-schema 与真实 PostgreSQL sentinel 阻塞。
5. 跨切面 `X-Request-ID` request Header、162 个 operation 的 400 response 与所有已声明 response 的 `X-Request-ID` Header 单独同步；runtime owner 来自 middleware 的实际常量/行为，不读取冻结合同覆盖 runtime。
6. 最终启用完整 comparator，删除首个 2xx 旧路径和 report-only 入口，执行正式 full-scope gate。
7. 父任务最终 Review 发现 checker 漏枚举三种合法 OpenAPI 方法；独立修复 Task 补齐八种方法和默认 `check()` 双向 mutation，并重新运行受影响定向验证及一次 `make contract-check`。

中间子任务没有提前声称默认门禁完成；Phase F 在前序零漂移后完成激活，方法覆盖修复关闭最终 Review gap。本父任务未被作为直接实现任务启动。

## Public Contract Impact

已完成的公共合同变更只反映既有且经证据确认的 HTTP 行为：

- 补齐当前静态合同漏掉的依赖/command/error statuses，并删除 `testAIModel` 不会逃逸的 502/504。
- 修正 149 个 validation-capable operation 的 422 status/`ErrorEnvelope` metadata。
- 修正 health nullable、GEO discriminator、generation union、CSV media/header 等已观察 shape metadata。
- 把实际始终存在的 `ErrorDetail.details` 冻结为 required，并纳入 handler 行为 sentinel。
- 为全部 operation 冻结 `X-Request-ID` request/response Header 与非法值 400；login/logout 的多实例 `Set-Cookie` 明确留在 HTTP 行为测试边界，不用失真的单值 OpenAPI 声明代替。
- 重新生成并提交 `frontend/src/shared/api/generated/schema.d.ts`；不手改生成文件。

最终精确变更集必须由 authority reconciliation 子任务逐项冻结；不得把本审计的“至少”计数直接变成批量模板。

## Acceptance Criteria

- [x] checker 比较双方每个 operation 的完整规范化 response status key 集合，并覆盖 OpenAPI 3.1 八种 operation 方法。
- [x] 任意 status 只存在于一侧时失败，并输出 path、method、missing/extra status；不使用交集、allowlist 或 baseline。
- [x] 多个 2xx 全部比较；第二个 2xx 缺失或 shape 漂移会失败。
- [x] `default`、`1XX`–`5XX` 与显式 status 作为不同 key 精确比较；显式 code 不因 range/default 覆盖而被判等。
- [x] 双方共有且有 JSON body 的每个 status 递归比较字段、required、nullability、组合结构和机器约束。
- [x] 一侧有 body、另一侧无 body，或 media/schema 只存在于一侧时失败；CSV/header 漂移同样可定位。
- [x] 双方 204 均无 body 时通过；任一侧 204 添加 body 时失败。
- [x] 非 2xx `ErrorEnvelope` 的字段、required、类型或约束漂移时失败；runtime 422 不再指向 `HTTPValidationError`。
- [x] response/schema/header `$ref`、安全 `allOf`、`anyOf`、`oneOf` 和 nullable 表达按冻结语义展开；等价写法通过，真实语义漂移失败，`oneOf` 分支 multiplicity 不被去重。
- [x] description/title/examples 等 annotation 不造成失败；声明的 headers 进入完整比较，大小写归一化碰撞和非法 schema/content 组合失败；links 不被静默忽略。
- [x] authority matrix 覆盖 `X-Request-ID`、`Content-Disposition`、login/logout `Set-Cookie` 与统一 ErrorEnvelope；前两类进入 OpenAPI parity，Cookie 保留多实例 HTTP sentinel，`details` required 与实际 handler 一致。
- [x] mutation tests 覆盖 missing/extra operation、missing/extra status、非 2xx schema、multi-2xx、204 body、media、header、ref/composition、nullable 及 `HEAD`/`OPTIONS`/`TRACE` 双向漂移。
- [x] authority sync 逐项基于真实依赖/命令/行为证据；不批量猜测 401/403/404/409，不改变业务 HTTP 状态、error code、权限、事务或异常映射。
- [x] 最终 `make contract-check`、backend 定向测试和 frontend `api:check` 通过；CI 继续执行同一 `make contract-check`。
- [x] `app.openapi()` 未读取或合并 `contracts/openapi.yaml`，不存在 ignored route/status/method 机制或统一默认 ErrorResponse 覆盖。
- [x] 现有 `v2-live-readonly-acceptance` 保持 `in_progress`，父基线保持 `planning`；既有 dirty files/artifacts 未被纳入。

## Out of Scope

- `integrity-error-domain-mapping`（后续 3F）。
- 新增或重命名业务 error code，改变权限、状态转换、事务、异常映射或实际 HTTP 行为。
- 前端页面/交互、数据库 migration、生产环境调用或数据写入。
- 无关 router/service 重构、通用错误框架、从 service 静态生成状态集合。
- 通过 contract overlay、默认错误模板、ignored status/path 或长期 report-only 模式维持假绿。
- CI `push`/`pull_request` trigger、平台级 500 合同与其他发布流程配置。
- 用 OpenAPI 单值 Header Object 伪装 login/logout 的多实例 `Set-Cookie` 传输行为；Cookie 行为仍需保持既有 HTTP sentinel。

## Review Gate

九个直属子任务与两个独立阻塞修复均已有工作提交、required validation 和 Review 证据。Phase F 候选 `000a0d27` 的正式 full-scope gate 与方法修复 `b2bc3c6` 后唯一一次 `make contract-check` 均通过；最终 release-gate targeted re-review 无未解决 MEDIUM+。父任务收尾只运行 task validation、父文档 whitespace、Git 范围、archive/status/parent 与当前 inventory 核对，不再重复正式门禁。
