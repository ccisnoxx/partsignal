# T6-P Publication 真实错误码恢复验收

用户授权：补齐 T6-P，实际行为缺口才修复，必要定向验证后核对关闭两层父任务。不部署、不提交推送。

T5-G 已由独立只读复核确认无 material blocker；此任务继承 T5-C implement.md §9 合同。只修改 Publication 定向测试与其 production-artifact fixture；必要行为修复限原 T6-P allowlist。增加 published-content-issues.spec.ts 以直接验证 repair 竞争场景，复用 publication-work-list.spec.ts 验证共享 fixture。不得改 backend/wire details/schema 或猜测 repair ID。

- [x] 用真实 REVISION_CONFLICT / PUBLICATION_IDENTITY_CONFLICT / IDEMPOTENCY_CONFLICT / PUBLICATION_CONTEXT_INCOMPLETE 替换业务验收假码，覆盖 Work key 复用和失效区别。
- [x] REPAIR_TASK_EXISTS 空 details 不推测 ID、不自动 replay；显式双 Context 重读失败仍冻结，成功后使用 canonical repair ID。
- [x] OPEN_ISSUE 使用真实 PUBLISHED_CONTENT_ISSUE_CONFLICT，保留输入且重读后交接已有问题。
- [x] 完成五个指定测试文件、类型检查、scoped lint 与三个 publication fixture 浏览器规格；记录实际命令/边界/必要修复。
- [x] 按当前合同和后续交付核对父任务原 15 consumer，收尾父任务并保留 AC11 NOT_CAPTURED。
