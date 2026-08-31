# Content Editor 提交审核命令冲突恢复

## Goal

让 Content Editor 的 `SUBMIT_REVIEW` 命令复用页面唯一的 `REVISION_CONFLICT` 恢复机制。提交审核发生 revision conflict 后，页面必须保留当前编辑上下文、全部本地表单值和审核备注，精确展示服务端 `ErrorResponse` 的 `code`、`message` 与 `request_id`，禁止自动重试、自动重放或通过后台刷新静默采用新快照。只有用户执行显式 reload 且该读取成功后，页面才能采用服务端最新 canonical editor context、revision、`primary_task` 与 `available_actions`。

本 Task 是 `frontend-v2-functional-contract-conformance-baseline` 的独立后续 Task，只修复这一条前端恢复语义，不扩大到全局错误框架、后端或公共合同。

## Authoritative Inputs

- 根与前后端 `AGENTS.md`、`.trellis/workflow.md`。
- 父 Task 的 `prd.md`、`design.md`、`implement.md` 与 `research/route-conformance-matrix.md`。
- `docs/frontend-v2/03-page-and-workflow-blueprint.md`、`04-design-system-and-interaction-spec.md`、`05-business-actions-state-and-api-contract.md`、`06-code-architecture-and-project-structure.md`、`08-testing-quality-and-acceptance.md`、`09-architecture-decisions.md`。
- `contracts/openapi.yaml`、相关 `.trellis/spec/`，以及当前 Content Editor 前端、fixture/E2E 和后端 submit-review 实现。

## Confirmed Problem

当前 `SAVE`、`DELETE` 与 `ABANDON` 的失败都进入 `ContentEditorWorkspace.applyMutationError`，由 workspace 的 `conflict`、`requestId`、RHF 表单和 `reloadCanonical` 形成统一恢复语义。`SUBMIT_REVIEW` 则直接把 `submit.mutateAsync` 的异常抛给 `SubmitContentDialog`；Dialog 将异常压成自己的普通字符串 `error`，因此 409 不会设置 workspace conflict，不会把 `request_id` 投影到统一错误摘要，也不会进入现有 reload 边界。

现有 reload 还有一个必须在本 Task 内一并关闭的同源缺口：`onReload` 只返回 `context.refetch()` 的 `.data`。TanStack Query 在 refetch 失败且已有 cache 时可能同时保留旧 data 和 error；若仅检查 data，页面会把旧 cache 当作 reload 成功，清空冲突并重置本地表单。该行为直接违反“只有成功读取最新 canonical context 才能采用”的目标。

## Requirements

1. `SAVE`、`SUBMIT_REVIEW`、`DELETE` 与 `ABANDON` 的 `REVISION_CONFLICT` 必须进入同一个页面本地 conflict owner；不得为提交 Dialog 新建第二份 conflict、request ID 或 reload 状态，也不得引入全局 Store。
2. conflict owner 必须保存结构化 `{ code, message, requestId }`。冲突表面必须原样展示服务端 code、message 与 request ID，不得以“提交失败”之类泛化文案覆盖。
3. `SUBMIT_REVIEW` 409 后必须保持 Dialog 打开，并保留审核备注、标题、摘要、Markdown 正文、标签、变更说明、当前编辑模式、dirty baseline、base revision 和当前已采用的 editor context。
4. 冲突期间不得因窗口聚焦、query invalidation、旧在途 GET 或现有高 revision 同步 effect 自动采用 query data。所有携带旧 revision 的写动作必须不可再次执行，直到显式 reload 成功。
5. 显式 reload 必须发起一次真实 `GET /api/v1/content-tasks/{content_task_id}/editor-context`。只有 refetch 结果明确成功且含有 fresh data 时，才能重置表单与 base revision，并采用该响应的完整 context、task `primary_task`、task/current-content `available_actions` 和编辑模式。
6. reload 成功后清除原 conflict 与 conflict request ID，关闭提交 Dialog，丢弃审核备注，并按新服务端动作投影重新呈现页面；不得自动重新提交 `SUBMIT_REVIEW`。
7. reload 失败后保留原 conflict、原 conflict request ID、Dialog、审核备注、表单值、base revision 和已采用 context。读取错误继续由现有 query error owner 展示，并提供同一个显式读取动作重试；不得把旧 cache data 当成功。
8. 用户在 conflict 后取消 Dialog 时，只关闭 Dialog 并显式放弃本次审核备注；不得发起 GET/POST，不得清除页面 conflict，也不得改变本地表单或 base revision。页面仍提供显式 reload。
9. 一次确认提交最多产生一次 submit-review POST。409、Dialog 保持、取消、reload 失败和 reload 成功均不得触发 mutation retry 或 replay。
10. 提交成功的关闭 Dialog、停留 Editor、刷新 canonical context 与动作投影行为保持不变；401、403、404、422 和普通 5xx 继续使用现有非冲突错误路径，不误进入 revision conflict，也不自动 reload/replay。
11. 现有 `SAVE`、`DELETE`、`ABANDON` 成功与冲突恢复语义保持不变。前端动作存在性继续只来自服务端 `available_actions`，不得从 status 或错误 code 推导业务资格。
12. Dialog 必须维持焦点约束和可访问错误语义：打开后焦点进入备注输入；409 错误可被辅助技术立即识别；普通取消优先返回原触发器；触发器因 conflict 被禁用或 reload 后消失时，焦点返回稳定的 Content Editor 标题或冲突恢复区域。

## State Preservation Matrix

| 事件 | 表单 / Markdown | 审核备注 / Dialog | conflict 与 request ID | editor context / revision / actions | 网络副作用 |
| --- | --- | --- | --- | --- | --- |
| submit-review 409 | 保留 | 保留并保持打开 | 采用该 409 的结构化值 | 保留旧已采用快照 | 仅一次 POST |
| conflict 后取消 | 保留 | Dialog 关闭，备注由用户显式放弃 | 保留 | 保留 | 无新增请求 |
| 显式 reload 成功 | 采用 fresh GET | Dialog 关闭，备注清除 | 清除 | 原子采用 fresh GET 全部投影 | 一次 GET，零 POST |
| 显式 reload 失败 | 保留 | 保留当前开关和备注 | 保留原冲突；另由 query error 呈现读取失败 | 保留旧已采用快照 | 一次失败 GET，零 POST |
| 非冲突 submit 错误 | 保留 | 保持现有普通错误行为 | 不进入 conflict | 保留 | 仅一次 POST |

## Non-goals

- 不修改 backend、`contracts/openapi.yaml`、generated client、数据库、迁移或生产数据。
- 不补齐 submit-review endpoint 当前 OpenAPI 非 2xx response 声明；这是审计确认的既有合同声明缺口，但用户已明确排除，本 Task 只复用运行时 `ErrorEnvelope` 解析能力。
- 不修改 Content AI production surface、FAILED retry owner、job tracking、Query Topic 冲突或 Dialog projection、deletion Dialog 系列问题。
- 不重构全局错误处理、QueryClient 默认策略、Dialog primitives、StickyActionBar 或 Content API 架构。
- 不调整视觉风格、品牌、配色或动效，不做无关清理。
- 规划阶段不实施修复，不运行 `task.py start`，不提交、不推送。

## Acceptance Criteria

- [ ] `SUBMIT_REVIEW` 返回 `409 REVISION_CONFLICT` 时进入与其他 Editor mutation 相同的唯一显式冲突恢复状态。
- [ ] 冲突表面展示服务端原始 `code`、`message` 和 `request_id`；Dialog 不保存第二份 conflict/reload 错误状态。
- [ ] 标题、摘要、Markdown 正文、标签、变更说明、base revision、当前 editor context 和审核备注在 409 后不被静默覆盖。
- [ ] 409 后 Dialog 保持打开，确认提交不可再次执行；取消只关闭 Dialog，不清冲突、不读、不写。
- [ ] 冲突期间窗口聚焦或旧在途读取不会自动采用新 context；用户显式 reload 前，页面仍投影原已采用 revision 与 actions。
- [ ] 显式 reload 每次只产生一次真实 editor-context GET；只有成功 fresh response 才采用最新 context、revision、`primary_task` 和 `available_actions`。
- [ ] reload 成功清除 conflict/request ID、关闭 Dialog并按服务端投影更新模式与动作，但不会重放 `SUBMIT_REVIEW`。
- [ ] reload 失败保留冲突、原 request ID、表单和 Dialog 备注，并提供可重试读取动作；旧 cache data 不得被当作成功。
- [ ] 单元测试和 Playwright 均断言一次提交点击最多一个 POST，409、取消与任何 reload 后 POST 总数仍为 1。
- [ ] 单元测试和 Playwright 均断言显式 reload 前 GET 总数不增加，reload 失败/成功各只增加一次 GET。
- [ ] 提交成功，以及 401、403、404、422、普通 5xx 的现有行为保持不变。
- [ ] `SAVE`、`DELETE`、`ABANDON` 的已有成功与 conflict 路径不回归。
- [ ] Dialog 的错误 announcement、焦点进入和关闭后的稳定焦点恢复有组件测试；E2E 覆盖实际 Dialog 保留与按钮可用性。
- [ ] `contracts/openapi.yaml`、generated client、backend、数据库与生产数据均无变更，`npm --prefix frontend run api:check` 通过。
- [ ] 仅修改本 Task 列出的前端 owner、定向测试与 fixture；不纳入任何既有脏文件或 artifacts。

## Review Gate

本文件、`design.md`、`implement.md` 与审计研究记录通过人工 review 后，才能运行 `task.py start`。在用户明确批准前，本 Task 保持 `planning`；父基线 Task 不归档，`v2-live-readonly-acceptance` 保持 `in_progress`。
