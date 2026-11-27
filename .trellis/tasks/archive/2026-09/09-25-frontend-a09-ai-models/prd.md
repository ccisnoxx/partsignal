# A09 AI 渠道 Models tab

## Goal

验收 `/settings/ai/$channelId?tab=models` 的按需模型读取、发现、创建/编辑/测试/启停/删除与 revision 边界。

## Requirements

- 前置 A08 已按本轮证据完成；权威为 AI Models blueprint、`05-business-actions-state-and-api-contract.md`、`08-testing-quality-and-acceptance.md`、任务清单 A09 与 OpenAPI。
- Models 集合只在 active tab 读取。发现结果只保留在 Dialog；create 无 revision，edit/test/enable/disable/delete 使用当前模型 revision。
- JSON 配置只接受 object 并拒绝 `model/messages/stream`；真实测试失败显式，409 保留编辑草稿或当前投影，仅成功显式 reload 解冻。
- 未知/重复/矛盾 action 显式失败，模型 secret 不回显、不进缓存或 trace。

## Acceptance Criteria

- [x] page/model/API 与 PostgreSQL 直接测试覆盖 lazy collection、discover、CRUD/test/status/delete、revision/409、JSON 与权限。
- [x] 当前 production 验收覆盖模型发现、连接测试、错误、焦点、响应式和敏感边界；真实 Provider 与正式生成由 A11 业务闭环单独验收。
- [x] 记录实际代码、独立复核、残余风险及 A11 后继；检查实际 diff/工作树。

## Notes

- 复杂模型状态设计与实施顺序见同目录 `design.md`、`implement.md`。

## 本轮实施与验证证据

- `ai-channel-models-section.tsx` 将 create/update/test/toggle/delete 的 canonical response 立即写入 exact Models cache，命令锁不再等待消费者刷新。create/test 只刷新 AI 投影，update/enable/disable/delete 才刷新 Preview 与 Content 消费者；刷新失败只提供 GET retry，不重放命令。
- revision hold 按 `modelId + command + intent epoch` 隔离。Dialog 或页面 Notice 的旧 reload 无论迟到成功还是 503/网络失败，都不会关闭、解冻或污染后来的同模型 intent；当前 intent 显式 reload 后才采用最新 revision。test 确认时从 exact query 重读目标和 action；discovery 409 只由成功 Detail reload 解冻，未知/矛盾投影显式失败。
- 当前 direct Models suite **13/13**，其中 deferred 回归在旧 503 结算后等待 exact query `fetchStatus=idle`，再证明新 hold/Dialog 未被覆盖并以 revision 7 提交。PostgreSQL `test_ai_channel_management.py` **9/9**；production Models Playwright mobile/desktop **8/8**；production build、typecheck、所属 ESLint 与 `git diff --check` 通过。
- 独立复核先后找到 Dialog/Notice 迟到成功、迟到失败和 create 消费者误刷新边界；最终复核确认生产实现无阻断。真实 Provider 发现/测试与 Preview 正式副作用留给 A11 当前真实栈闭环，不复用历史 V2 门禁。
