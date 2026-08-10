# 设计：Frontend V2 Content Editor

## 拆分依据

Core 是同步、请求驱动的 Workspace slice；AI Production 是作业、轮询、幂等和 immutable snapshot 驱动的异步 slice。两者共享 Editor Context 和 action projection，但拥有不同的失败模型、E2E 数据流与回滚边界，因此分成顺序子任务。

## 共享架构边界

- 路由依赖方向固定为 `routes -> domains/content -> design-system/shared`。
- Server state 使用 TanStack Query，form state 使用 React Hook Form，tab/dialog 使用 React local state。
- Editor 首屏只读取 Task 级 Editor Context；generation options、完整 job snapshot 和 destructive preview 按需读取。
- `current_content_version_id` 是唯一主线；服务端返回 canonical current content、actions、comparison 和 diff。
- Preview 复用 sanitized Markdown；Diff 只绘制服务端 `ContentDiff`。

## 兼容与回滚

- 新增 Editor Context endpoint，不改变 V1 已使用 endpoint 的 wire shape。
- 每个子任务使用独立临时分支；出现合同或 real-stack 阻塞时可独立回滚，不影响另一个子任务。
- 不引入数据库迁移；既有数据库不可变规则保持权威。
