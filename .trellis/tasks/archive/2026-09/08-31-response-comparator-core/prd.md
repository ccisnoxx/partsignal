# 完整 Response Comparator 核心

## Goal

在不改变当前 `make contract-check` 默认行为的前提下，为 `backend/app/tools/contract_check.py` 建立纯、可独立 mutation-test 的完整 response comparator，并提供调用同一 comparator 的只读全量 drift report。它必须可靠发现每个 operation 的完整 response status/shape 漂移，为后续合同与 runtime metadata 同步提供证据。

本 Task 是 `08-31-non-2xx-contract-check` 集成父任务的 Phase A。父任务已经完成人工批准；本 Task 不拥有公共合同修正、runtime metadata 同步或最终门禁启用。

## Confirmed Baseline

- 冻结合同与 runtime OpenAPI 各有 162 个 operation，其中 156 个 status key 集合不一致；现有 checker 仍通过，因为只比较首个 2xx。
- 当前 checker 还会忽略非 JSON media、schema 缺失/空 schema 区别、第二个 2xx、全部非 2xx，以及部分 nullable/composition 机器语义。
- FastAPI 锁定版本为 0.139.0；自动 422 的生成条件必须通过最小 app 测试冻结，不能依赖记忆或宽版本推断。
- 详细计数与调用链证据位于父任务 `research/response-drift-classification.md` 和 `research/route-response-authority-audit.md`。

## Requirements

1. 新增 document-level 纯 comparator，输入两份已解析 OpenAPI document，返回稳定排序的全部 response failures；纯层不得读文件、import 全局 app 或修改输入对象。
2. 对每个共享 operation 比较规范化后的完整 response status key 集合。精确三位 `100`–`599`、小写 `default`、大写 `1XX`–`5XX` 才合法；显式 code、wildcard、default 不互相覆盖或判等，规范化碰撞必须失败。
3. 对每个共有 status 使用同一路径比较 response-level local `$ref`、body/media/schema 存在性、完整 media key 集合、递归 schema shape 与 response headers；多个 2xx 和所有非 2xx 不得走特殊捷径。
4. `content` 缺失与空 mapping 均表示未声明 body；不存在 schema、合法空 schema `{}` 与非空 schema 必须区分。数值 `<200`、204、205、304 和 `1XX` wildcard 声明任何 media 时，即使双方相同也必须失败。
5. response/schema/header local `$ref` 必须按各自 document 的 RFC 6901 Pointer 展开；inline/ref 等价表达通过，坏引用、外部引用及无法安全解释的循环显式失败，递归 schema 不得无限展开。
6. schema comparator 保留 object/array/scalar 字段与既有机器约束，支持安全 `allOf`、`anyOf`、`oneOf`、OpenAPI 3.1 null union。`anyOf` 可语义去重；`oneOf` 必须保留重复分支 multiplicity。遇到旧式 `nullable` 显式报 unsupported/invalid，不猜测 OpenAPI 3.0 兼容语义。
7. response header 名按大小写不敏感规则比较并检测碰撞；Header Object local ref、schema/content 互斥、content 单 media、schema shape 和适用的序列化字段必须比较。`Set-Cookie` 的实际多实例 authority 留给后续 HTTP sentinel，本 comparator 只比较文档中已声明的 Header Object。
8. description、title、example(s)、`$comment` 等 annotation-only 字段不比较；`default`、format、readOnly/writeOnly、discriminator、deprecated 等项目已冻结或影响 validation/serialization/generated client 的机器字段继续比较。当前未出现的 links 若出现必须报 unsupported，不能静默忽略。
9. diagnostics 使用稳定 RFC 6901 JSON Pointer，聚合全部 failures，并明确 `missing_in_contract` / `missing_in_runtime`、status、media/header 或 schema constraint 位置。
10. CLI 明确解析现有可选 contract path，并增加无 filter/suppress/allowlist 的 `--response-report`。report 调用同一纯 comparator；发现当前 drift 时稳定输出并非零退出。
11. 默认 `check()` 在本 Task 中不得接入新 response comparator，`successful_response()` 旧路径暂不删除；`make contract-check` 必须继续按现有能力通过。最终切换只属于父规划 Phase F。
12. 不修改 `contracts/openapi.yaml`、generated client、router、schema model、错误 handler、Makefile、CI 或任何业务行为；不新增 drift baseline、ignored operation/status/path 或 frozen-contract overlay。

## Acceptance Criteria

- [x] synthetic documents 证明 missing/extra status、第二个 2xx 缺失/shape 漂移和非 2xx envelope drift 都失败。
- [x] 双方 no-body response 通过；任一侧或双方给 204 等 no-body status 添加 content 时失败。
- [x] body presence、完整 media set、schema absent/`{}`/non-empty 与 CSV/header 漂移均能精确定位。
- [x] response/schema/header inline/ref 等价通过；坏 pointer、外部 ref、header name 碰撞和非法 schema/content 组合失败。
- [x] safe `allOf`、`anyOf`、`oneOf`、nullable、required、property/items 与机器约束 mutation 有正反例；重复 `oneOf` 分支不被去重。
- [x] annotation-only 差异通过；未知机器字段与 links fail closed。
- [x] diagnostics 对包含 `/`、`~` 的 path/media/property 正确 RFC 6901 转义并稳定排序。
- [x] FastAPI 0.139.0 最小 app 锁定 path/query/header/cookie/body 自动 422，以及显式 422、4XX、default 的抑制条件；自定义异常 handler 本身不改变 OpenAPI metadata。
- [x] `--response-report contracts/openapi.yaml` 对当前完整漂移非零退出且不提供忽略机制。
- [x] 默认 `check()` 与 `make contract-check` 仍按 Phase A 之前的 live gate 行为通过，没有提前启用新 comparator。
- [x] diff 只包含 `backend/app/tools/contract_check.py`、新建的 `backend/tests/unit/test_contract_check.py` 及本 Task 自身记录；无公共合同、runtime metadata 或业务行为变化。

## Out of Scope

- 修正当前 156 个 status-set drift 或 7 个成功 schema drift。
- 修改 `ErrorEnvelope`、422 metadata、CSV response metadata 或任何 router `responses=`。
- 同步 `X-Request-ID`/400、Cookie 行为、静态 OpenAPI 或 generated client。
- 接入默认完整 gate、删除首个 2xx 旧路径或修改 CI trigger。
- 业务错误、权限、状态转换、事务、数据库和前端修改。

## Review Gate

父规划及“创建并启动 Phase A 子任务”已于 2026-08-31 获人工批准。本 Task 只能按上述聚焦范围进入 Phase 2；若实施需要改变公共合同、runtime metadata 或默认门禁，必须退回父任务重新规划，不得扩大本 Task。
