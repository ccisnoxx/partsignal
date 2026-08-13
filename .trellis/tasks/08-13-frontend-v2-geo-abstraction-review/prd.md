# Frontend V2 GEO abstraction review

## Goal

完成 Frontend V2 Phase 5 GEO vertical slice 的抽象回顾与退出门禁审计；只关闭有现有代码证据的合同、缓存所有权和 Design System 漂移，不新增 GEO 业务能力，不提前进入 Phase 6。

## Final audit conclusion

- Phase 5 为 `MET`。
- 未解决 P0/P1/P2 均为 0。
- 合法大写 UUID、GEO mutation 缓存消费者和输入 primitive 三项缺口已关闭。
- route/domain/API/read-model/action/immutability/test 分层保持唯一 owner，没有新增框架、依赖或第二状态源。

## Requirements

### R1. Preserve the established architecture

- 保持 `routes -> domains -> design-system/shared`。
- route 继续只承担 search/params 校验、loader/prefetch、metadata、canonical redirect 和页面组合。
- GEO 页面继续只通过 `geo.api.ts` 及相关 domain API owner 调用 generated client。
- 不把 GEO DTO、动作 token、read model 或缓存规则提升到 Design System。

### R2. Accept every route-valid UUID identity

- `z.uuid()` 接受的 UUID 大小写形式必须与 FastAPI/Pydantic 的 `uuid.UUID` 规范化响应视为同一身份。
- Detail 与 Correction Context 的身份/链断言仍须拒绝真正不匹配的 UUID、链顺序、节点标记和动作投影。
- 修复应落在 GEO Detail model 的身份比较 owner，不在 route、API wrapper 或各调用页增加补丁。

### R3. Invalidate every real consumer after GEO mutations

- Observation create/correct/delete 成功后，除既有 List/Detail/Correction Context 外，还必须失效会读取该事实的 GEO Insights、Query Topic list-items 引用摘要以及对应 Product Detail。
- Topic create/update/delete 成功后，除既有 Topic options/list、Observation、Correction Context 和 Content consumers 外，还必须失效 GEO Insights。
- List 行删除必须保留被删行的 `product.id` 以精准失效 Product Detail；不得改为全量 Product cache 失效。
- 不新增通用 cache framework、event bus、global store 或只有一个实现的 invalidation interface。

### R4. Use the established Design System input boundary

- Insights Screen 的筛选 select 与 Optimization Dialog select 使用既有 `design-system/primitives/select`。
- New Observation 与 Correction Workspace 的 textarea 使用 Design System `Textarea` primitive；若 primitive 尚未实现，则只补与现有 `Input`/既有 textarea 样式一致的最小 primitive 与最小 primitive test/story。
- 保留表单 label、error association、keyboard、focus、disabled/pending 和窄屏行为。
- 不改视觉方案，不创建通用 Form 或 Analytics framework。

### R5. Preserve server-owned business behavior

- Observation/Topic/Insights 动作继续只消费 `workflow_stage`、`primary_task`、`available_actions`、`optimization_action`。
- Correction 继续使用服务端 `chain_tail_id` 生成 `supersedes_id`；409 不 replay。
- Observation 与历史 evidence 继续 append-only/read-only；本任务不修改后端、数据库、权限、OpenAPI 或公共 API contract。

### R6. Keep tests complementary

- model/unit test 只新增 UUID 规范化与输入 primitive 的最小回归。
- component/page test 只新增各 mutation 真实消费者失效的断言，以及被替换控件的关键可访问行为。
- 不重写 fixture E2E 或 real-stack 基础设施；仅在 targeted evidence 无法覆盖 route-valid UUID 或控件交互时补最小既有 spec。
- 不因表面重复删除现有 unit/component/fixture/real-stack 证据。

### R7. Close documentation drift and re-evaluate the gate

- 更新权威 Frontend V2 文档与相关 Trellis frontend spec，使 mutation consumers、UUID identity 和 primitive 使用与实现一致。
- Phase 5 只有在 P1/P2 全部关闭、required validation 通过且代码/合同/生成类型/文档一致后才改判 `MET`。

## Acceptance Criteria

- [x] 大写 UUID 的 Detail 与 Correction direct URL/refresh 不再触发合同不一致；真正错配仍显式失败。
- [x] Observation create/correct/delete 成功后，GEO Insights、Topic list-items 和对应 Product Detail 均按真实影响失效。
- [x] Topic create/update/delete 成功后，GEO Insights 与既有消费者均失效。
- [x] GEO Insights 不再手写 native `<select>` 样式；New/Correction 不再复制 domain-local textarea 样式。
- [x] route/API/read model/action/immutability 所有权保持不变，没有新增通用框架、依赖或第二套状态源。
- [x] targeted model/component tests、frontend typecheck、lint、build、OpenAPI generated check 和文档一致性检查通过。
- [x] 既有 GEO real-stack `12 passed` 与 V1 Trusted Types `7 passed` 作为最近闭环证据被保留；实现范围与 required check 未暴露跨栈风险，因此没有机械重跑全套 real-stack。
- [x] Phase 5 最终证据矩阵无未解决 P0/P1/P2，已标记 `MET`。

## Constraints / Non-goals

- 不新增 GEO 页面、字段、动作或业务流程。
- 不修改 backend、database migration、权限、OpenAPI、旧 `frontend/` 或 deployment。
- 不因文件行数进行机械拆分。
- 不创建通用 Table/Form/Analytics/Workspace framework，不新增依赖、Redux、Next.js 或新状态系统。
- 不开始 Platform、Workbench、Cutover 或 Phase 6。
- 实施已在用户批准的 `codex/frontend-v2-geo-abstraction-review` 临时分支完成，并已获得提交批准；不自动 push 或创建 PR。
