# A06 Prompt 预览与真实生成

## Goal

验收 Prompt 预览的明确 Task/模型选择、真实生成确认、返回 Job 追踪与 terminal ContentVersion 展示。

## Requirements

- 前置 A05；实现只在 A05 本轮完成后关闭。权威为 Prompt Preview blueprint、`05-business-actions-state-and-api-contract.md`、`08-testing-quality-and-acceptance.md`、任务清单 A06 与 OpenAPI。
- 用户必须明确选择 Content Task 与模型并确认真实生成副作用；只追踪服务端返回 Job，不轮询或猜测其他 Job。
- terminal 成功后展示不可变 ContentVersion；失败、权限拒绝、未知状态与超时均显式，不伪装成功、不合成内容。
- preview 的 secret、请求与结果不进入 URL/trace；返回链接、焦点和响应式布局保持可恢复。

## Acceptance Criteria

- [x] page/model/API 与 PostgreSQL 直接测试覆盖 options、确认、Job 状态、terminal version、权限与失败。
- [x] 当前 production/真实栈验收覆盖真实生成副作用、只跟踪返回 Job、失败不伪成功和敏感边界。
- [x] 记录实际代码、独立复核、残余风险及 A11 后继；检查实际 diff/工作树。

## Notes

- 复杂异步状态设计与实施顺序见同目录 `design.md`、`implement.md`。

## 本轮实施与验证证据

- `PromptPreview` 仅在已保存 Prompt、显式 Test Context/模型与二次确认后创建真实 GenerationJob；mutation 成功后只采用服务端返回 Job 的 ID，列表缺失该 Job、未知状态、terminal 缺 ContentVersion 身份与读取失败均显式报错，不选择其他 Job 或拼装成功内容。
- 只有该返回 Job 为 `SUCCEEDED` 且携带 `content_version_id` 时读取不可变 ContentVersion；terminal 后停止轮询并精确刷新 Preview 消费者，refresh 失败保留已确认结果并提供只读重试。
- 直接验证：`prompt-preview.test.tsx` 23 项；Prompt Workspace production fixture mobile/desktop 16 项；PostgreSQL Preview Options 1 项；typecheck、ESLint 与 production build 均通过。独立复核未发现 blocker。
- A11 当前 production real-stack 从 UI 明确选择 Preview Task/模型并确认真实副作用，实际 `POST generation-jobs → Worker → provider → SUCCEEDED → ContentVersion GET`；页面展示返回 Job、Version、标题、正文与全屏不可变版本。Preview 与正式生成使用不同 Content Task，provider 总调用 4 次，Usage 业务作业 2、成功 2、失败 0。
- 同一真实栈 `1 passed`，`E2E_SECRET_SCAN status=clean`，`E2E_RESULT playwright=0 secret_scan=0`；数据库、Redis、storage、端口和子进程完成清理。A06 的 A11 后继真实副作用缺口已经闭合。
