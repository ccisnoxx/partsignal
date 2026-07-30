# 修复 DEF-002 内容任务列表投影字段泄漏

## Goal

修复完整发布回归中发现的内容任务列表接口 500：内部幂等字段 idempotency_key 泄漏到 ContentTaskListItem，补充列表/详情/创建幂等回归验证，不改变 API 合同和数据库结构。

## Requirements

- `GET /api/v1/content-tasks` 及其平台筛选请求必须只返回
  `ContentTaskListItem` 合同声明的字段，不得暴露内部 `idempotency_key`。
- 内容任务详情投影继续排除 `idempotency_key`。
- 内容任务创建接口的幂等行为保持不变：相同幂等键重试返回同一任务，冲突请求
  继续显式失败。
- 修复必须位于共享投影职责内，不在路由或调用方增加重复兼容逻辑。
- 不修改 OpenAPI 合同、数据库结构、迁移文件或部署配置。
- 不为未知 ORM 字段增加静默兼容；投影仍由明确的响应模型约束。

## Acceptance Criteria

- [x] 列表中同时存在 `idempotency_key` 为空和非空的任务时，接口均返回 200。
- [x] 列表响应及单条详情响应均不包含 `idempotency_key`。
- [x] 平台筛选列表请求返回 200，且字段集合符合 `ContentTaskListItem`。
- [x] 创建幂等重试与幂等冲突的既有测试继续通过。
- [x] 定向后端测试、相关 lint/类型检查和 Trellis 质量门禁通过。
- [x] 差异审查确认没有合同、数据库、部署和无关代码变更。

## Notes

- 父任务：
  `07-30-full-deployment-regression-def-001-def-ai-001`。
- 现场证据：
  `ContentTaskListItem.idempotency_key: Extra inputs are not permitted`。
- 修复提交推送后，父任务必须基于新的 `origin/main` 重新执行完整发布。
