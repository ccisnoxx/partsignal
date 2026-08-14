# Frontend V2 AI Channel Workspace Models

## Goal

为管理员交付 `/settings/ai/$channelId?tab=models` 的真实 Models vertical slice，闭环 AI Channel List 与 Workspace Header 的 `TEST_MODEL/DISCOVER_MODELS/CREATE_MODEL` handoff。模型发现、创建、编辑、连接测试、启停与删除只消费服务端权威 revision 和 action projection；真实 Provider 副作用显式、至多发送一次，失败或冲突不自动重放。

本 Task 是父 Task `08-14-frontend-v2-ai-channel-workspace` 的第二个实现子 Task。它依赖已归档 `frontend-v2-ai-channel-workspace-core` 已 fast-forward 合入 `main`；当前已验证 `main` 包含 Core 合同提交 `4dc71c2c`、V2 Core 提交 `cd3139b0` 与归档提交 `6ff4639d`。子计划经用户批准后已在 `main` 启动并完成实现，未创建开发分支。

## 已验证基线

- Core 已注册 `/settings/ai/$channelId`，但 delivered gate 仅开放 `basic|request`；`models` 当前在 detail 请求前进入 route-level not-found。
- V2 现有 `ai-channel.api.ts` 只有 models cache key 占位，没有模型 query 或 mutation；Workspace Header 的 `TEST_MODEL` 仍为禁用 handoff。
- OpenAPI 现有 model list/create/update/enable/disable 合同可复用；discovery 没有 request body，model test 没有 request body，model delete 没有 revision query。
- 后端 model test 已在外部调用后复核 channel/model revision，并保持模型停用；但调用前不比较用户所见 model revision。discovery 当前不做调用前后 channel revision 复核，model enable/disable 当前允许 no-op，model delete 当前不比较 revision。
- V1 Detail、V1 List、V1 E2E/shared setup、V2 `content-ai-real-stack.spec.ts` 均直接调用受影响 endpoint；合同收紧必须原子同步，不能增加 optional compatibility field 或固定 revision。
- 现有数据库 `ai_channels.revision` 与 `ai_models.revision` 足以表达本 Task 并发语义；无需迁移、Redis 状态或第二 revision owner。

## Requirements

### R1. Contract-first revision 收紧

- `POST /api/v1/ai-channels/{channel_id}/discover-models` 必须接收 required `RevisionRequest`，其中 `expected_revision` 属于 channel revision，并声明 `409/422`。
- `POST /api/v1/ai-models/{model_id}/test` 必须接收 required `RevisionRequest`，其中 `expected_revision` 属于 model revision。
- `DELETE /api/v1/ai-models/{model_id}` 必须接收 required non-negative `expected_revision` query，并声明 `409/422`。
- 保持 `AIModelCreate` 无 expected revision；新模型尚无自身 revision，不得传 `0`、channel revision 或先 GET 猜值。
- 保持 `AIModelUpdate`、model token union 与现有响应 read model；不增加 compatibility 字段、聚合 endpoint 或数据库字段。

### R2. 服务端最终权威与真实副作用

- discovery 在读取并锁定当前 channel 配置后先比较 expected channel revision，复制真实调用配置后释放事务；外部调用完成后重新读取并复核 channel revision。任一阶段 stale 都返回 `409 REVISION_CONFLICT`，调用后冲突必须丢弃结果。
- model test 在真实调用前比较 expected model revision，并保留既有调用后 channel/model 双 revision 复核；测试期间任一配置变化都丢弃结果并返回 409。
- stale-before-call 必须产生零次 Provider 请求；调用已开始后的并发变化最多产生一次请求，且不得自动重试。
- model delete 按既有 channel → model 锁序比较 model revision，stale 时在审计和删除前返回 409。
- model enable/disable 在 revision 校验后拒绝同态目标，返回 `409 INVALID_STATE_TRANSITION`，不得递增 revision 或写成功审计。
- discovery 不落库、不写永久审计、不计 Usage；model test 只回写安全测试状态/摘要，不写永久审计、不计 Usage，成功或失败后模型都保持停用。

### R3. V1 与直接调用者同步

- V1 Detail discovery 发送当前 channel revision；test/delete 发送目标 model revision，409 不自动重放。
- V1 List 的连接测试发送从真实 model list 读取的 model revision。
- `ConfigurationPages.test.tsx`、`ai-channel-management.spec.ts`、`mvp-flow.spec.ts`、`shared-data.setup.ts` 与 V2 real-stack 直接调用同步 required body/query；不得用 `as any`、固定 `0` 或 optional helper 绕过合同。连接配置变化已递增 model revision 时，必须从 canonical model list 重新取得 revision，不能继续使用旧 create/test 响应。
- V1 既有 Models/Usage/Logs 视觉与非受影响行为保持不变。

### R4. Models route、query 与状态所有权

- Core delivered gate 开放 `models`，`usage|logs` 继续保持 route-level not-found；不创建 200 占位、不把它们 canonicalize 到 Basic。
- Models tab active 时才读取 `GET /api/v1/ai-channels/{channel_id}/models`；Basic/Request 不请求模型集合。
- Query key 继续由现有 `aiChannelKeys` 拥有；Dialog 草稿、discovery 结果、request parameters、revision payload 不进入 query key。
- Basic/Request 共享配置表单只在配置 surface 挂载。确认离开到 Models 后必须卸载该表单，不能保留隐藏 dirty owner；Core 的 Basic↔Request 草稿、409 和 DirtyGuard 行为保持不变。
- Models 提供 loading、empty、error、显式 refresh 与 stale-data refresh failure，不用客户端字段重建服务端工作流。

### R5. Model discovery 与表单

- discovery 由用户明确确认后发起，Dialog 说明会使用当前真实渠道配置访问 Provider；pending 时禁止重复提交，React Query mutation 不自动 retry。
- discovery 结果只存在于当前 Dialog 局部状态，关闭即销毁，不 seed Query cache、不持久化、不写日志。
- `VIEW_CONFIGURED_MODEL` 定位真实模型行；`ADD_MODEL` 只预填 `model_id/display_name` 并打开创建表单，不自动创建或测试。
- create/edit 表单编辑 `display_name/model_id/request_parameters`。JSON 必须是对象，语法错误、非对象值以及 `model/messages/stream` reserved keys 在表单边界显式失败。
- create 使用现有合同并以服务端响应取得初始 model revision；edit 提交完整 `AIModelUpdate` 与当前 model revision。
- update 409 保留非敏感草稿、冻结旧 revision 提交资格，只允许显式重新加载模型集合；不得自动 refetch 覆盖草稿或重放。

### R6. Model actions 与冲突 UX

- 每行展示模型身份、`workflow_stage`、测试状态/最近测试安全摘要、启用状态与服务端动作；移动端主单元保留 model ID、阶段和测试事实。
- `primary_task/available_actions` 使用 domain-local typed exhaustive resolver，检测 unknown、duplicate、contradictory token；不得从 `test_status/is_enabled/channel.is_enabled` 推导动作资格。
- `TEST_CONNECTION/VIEW_FAILURE_AND_RETRY` 进入明确真实副作用确认；每次用户确认只发送一次。PASS/FAIL 后模型仍显示停用。
- enable/disable/delete 发送行当前 model revision；409 保留当前投影并提供显式 reload，不 optimistic、不 replay。
- `ENABLE_CHANNEL` 复用现有 channel command owner；`VIEW_MODEL_RUNTIME` 在 Runtime 尚未交付时显示明确禁用原因，不跳到假页面。
- Create/Edit/Test/Delete Dialog 与 RowActions 保持键盘可达、Escape/取消可用并恢复触发点焦点。

### R7. Cache、安全与错误边界

- discovery 成功不失效 cache。model create/update/test/enable/disable/delete 只按父 Task matrix 刷新 AI list/detail/models、该 channel logs，以及需要时的 Prompt Preview Options root 与 Content generation-options。
- model create 与 test 不失效 Prompt/Content；model update、enable、disable、delete 失效真实模型消费者；失败/409 不写、不失效。
- Provider error 只展示既有公开 AppError code/message 或模型安全 `last_test_error_summary`；不得包含 base URL、API Key、Header value、request parameters body 或 Provider response body。
- fixture、DOM、console、error、trace/snapshot 不得包含 secret sentinel 或完整可执行请求配置。

### R8. 测试、文档与交付边界

- backend contract/integration tests 覆盖 required revision、stale before call、change during call、single Provider call、PASS/FAIL 仍 disabled、delete stale、enable/disable no-op、ADMIN/CSRF 与公开错误无 secret。
- V2 model/component tests 覆盖 JSON boundary、action resolver、lazy query、discovery local state、revision payload、single-flight、conflict、cache callback 和 Core 配置表单回归。
- 扩展现有 strict fixture 并新增 Models production-artifact E2E；未知 API 继续 501 + teardown fail。fixture 只证明生产 UI，不冒充真实 Provider。
- 375/768/1024/1440 覆盖模型表/Dialog/JSON 输入、无页面根横向溢出、键盘与焦点恢复。
- 同步 OpenAPI、双端 generated types、`.trellis/spec/backend/ai-configuration-guidelines.md`、`.trellis/spec/frontend/state-management.md` 与直接受影响的 Frontend V2 docs。`contracts/database.md` 不修改，因为持久化合同不变。

## Acceptance Criteria

- [ ] OpenAPI、runtime 与双端 generated types 对 discovery/test/delete 暴露唯一 required revision 合同；create/update shape 不变。
- [ ] discovery stale-before-call 为零 Provider 请求；调用期间 channel 变化最多请求一次并返回 409，结果不落库、不审计、不重试。
- [ ] model test stale-before-call 为零 Provider 请求；调用期间 channel/model 变化最多请求一次并返回 409；PASS/FAIL 后均保持 disabled。
- [ ] model delete stale 返回 409 且无删除/成功审计；enable/disable no-op 返回 `INVALID_STATE_TRANSITION` 且无 revision/成功审计变化。
- [ ] V1 Detail/List、V1 E2E/shared setup 与 V2 real-stack 直接消费者使用真实 current revision，无 compatibility fallback。
- [ ] `/settings/ai/{uuid}?tab=models` 支持直达、刷新、Back/Forward 与 lazy single query；`usage|logs` 仍明确未交付。
- [ ] discovery、manual create、edit、test、enable、disable、delete 均为真实可操作能力，没有固定成功、自动创建、自动测试或自动重放。
- [ ] model action 只由服务端 token 映射；unknown/duplicate/contradictory projection 显式失败。
- [ ] request parameters 非对象/非法 JSON/reserved keys 被阻断；create 不伪造 revision，update/command 使用目标 model revision。
- [ ] 失败/409 不写或失效 cache；成功只按批准矩阵刷新，Prompt 正文、Content history、Generation Job/Version history 与 Usage 历史不受影响。
- [ ] secret sentinel 与完整请求配置不进入 response cache、DOM、console、error、audit、fixture log、trace 或 snapshot。
- [ ] Required validation 全部实际通过，或失败被证实为非本变更并在 closeout 说明；OpenAPI、代码、测试、spec/docs 一致。
- [ ] 无数据库迁移、新依赖、通用 model/workspace/table/action framework、第二 API/revision/state owner。

## Out of Scope

- Usage、Logs、period/page URL state、运行指标、审计详情 UI；它们属于后续 Runtime 子 Task。
- 完整 Configuration real-stack 浏览器闭环；三个 Workspace 子 Task 后由独立 E2E Task 验收。
- 自动发现、自动创建、自动测试、自动启用、批量操作、默认模型、Provider-specific adapter、模型排序/分页/搜索。
- 修改 channel Basic/Request、API Key/Header 合同或新增 channel aggregate endpoint。
- 数据库迁移、Redis 状态、部署配置、新依赖、通用 Workspace/Model Registry/Action Registry/Table/Form framework。
- 自动 retry/replay、optimistic model command、raw Provider error/body 展示、复制完整模型或渠道请求配置。
