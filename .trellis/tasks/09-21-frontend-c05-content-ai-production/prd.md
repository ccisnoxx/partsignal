# C05 编辑器 AI 生产与自然化

## Goal

验收编辑器内生成选项、明确确认、真实 job 生命周期、按原快照 retry 与自然化。

## Requirements

- 前置 C04 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 4.4 节、`05-business-actions-state-and-api-contract.md` 的 ContentEditorContext/GenerationJob 合同、`08-testing-quality-and-acceptance.md` 第 13.3 节及 OpenAPI。
- 仅用户打开对话框时读取 generation-options；生成前展示当前平台 Prompt/revision 并要求明确选择可用模型。任务与当前内容上的服务端 `available_actions` 决定入口，浏览器使用稳定幂等键，不拼装或猜测事实/Prompt snapshot。
- 创建真实生成/自然化 job，跟踪摘要并仅轮询活动作业；终态刷新服务端 Editor Context 与消费者。完整 job 详情按需读取；失败显示诊断并仅在服务端允许时按原 job ID 创建 exact snapshot retry。自然化生成新版本，源版本不变；未配置 Prompt、未知事实和服务端失败不得被固定成功路径遮蔽。
- 中文页面中的作业状态与说明可读，保留用于审计和排障的 request/job ID、错误码和原始只读快照。

## Acceptance Criteria

- [x] 组件测试证明选项按需读取、明确选择、幂等键、活动轮询、终态刷新、详情按需获取、失败重试和自然化。
- [x] 当前候选浏览器 fixture 通过生成/失败/重试/自然化交互；真实 PostgreSQL/FastAPI/Celery/fake AI 隔离栈通过 13.3 的成功、自然化、失败详情和 exact snapshot retry。
- [x] 记录实际代码、验收结果及 C06/C07/C08 下一步；历史门禁不代替本轮证据。

## Notes

- 范围限于 Content Editor 内 AI 生产组件及直接测试。真实栈使用本地隔离数据，不触发外部 AI 服务或部署。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：`frontend/src/domains/content/content-ai-production.tsx` 将面向用户的区域标题、自然化 Prompt 说明、状态 badge 和兜底错误文案改为中文；保留审计诊断用的 Job ID、错误码和按需只读原始快照。生成命令、状态所有权与 API 合同无需修改。
- `content-ai-production.test.tsx` 本轮 4/4 通过，覆盖选项按需读取与稳定键、活动 job 轮询/终态刷新、失败详情与按 job ID retry、自然化终态。`npm run typecheck`、`npm run lint`、`git diff --check` 通过。
- 本轮 `content-editor.spec.ts` 两个 Playwright project 32/32 通过，包含生成确认、失败快照/retry、自然化和编辑器整体回归；这是当前候选生产预览 fixture 验证。
- 本轮 `PARTSIGNAL_E2E_SPEC=tests/e2e/content-ai-real-stack.spec.ts deploy/scripts/e2e-local.sh` 在隔离 PostgreSQL/FastAPI/Celery/生产预览与本地 fake AI 上 1/1 通过。真实链路完成已批准虚构事实、生成首稿、自然化新版本且源版本不可变、独立超时模型的 `AI_PROVIDER_TIMEOUT`、按需完整 `content-markdown-v3` 快照、修改凭据后的 exact snapshot retry（`retry_of_id` 和 `input_snapshot` 与失败 job 一致）。隔离 Redis DB14、临时数据库/存储与服务端口由脚本确认清理，新增 Docker Compose 容器/卷已删除。
- 下一步 C06 内容审核、C07 内容版本详情；两者满足前置后进入 C08 Content 真实业务闭环，各项以自己的本轮证据为准。
