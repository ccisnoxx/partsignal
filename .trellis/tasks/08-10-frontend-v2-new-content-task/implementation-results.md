# 实施结果

## 1. 交付范围

- 实施提交：`326df9f feat(content): implement frontend v2 new content task`。
- `/content/tasks/new` 只包含 Product、Approved Fact Version、Target Platform、创建和取消；没有 Task Detail、Editor、Generation、Manual Draft、Review 或 Publication 代码。
- 新增 `GET /api/v1/content-tasks/creation-options`，在一致快照中用固定次数集合查询返回活动 Product、同产品非空 `APPROVED` FactVersion、活动 PlatformProfile 和 handoff Product 资格。
- `POST /api/v1/content-tasks` 继续使用三字段 `ContentTaskCreate`，在 advisory idempotency lock 后按 Platform → Product → Fact 持锁并重新校验；options 不是安全控制。
- V2 Form 复用 Content query keys/API/error mapping、Form Kit、Select、Button、DirtyGuard 和 ErrorSummary。`productId` 保持 URL 可恢复，Product 改变只清除 Fact，Platform 保留。
- 同一 payload 的失败重试复用浏览器原生 UUID key；payload 变化、成功或 `IDEMPOTENCY_CONFLICT` 后不复用旧 key。成功失效列表、清除 dirty、返回 `/content/tasks` 并显示一次性反馈。

## 2. Contract 与跨层一致性

- `contracts/openapi.yaml`、Pydantic schema、V1/V2 generated types 中的 `ContentTaskCreate` 均严格只有 `product_id`、`fact_version_id`、`platform_profile_id`。
- Creation options schema、router、query service、Content domain query、fixture 和页面消费字段一致；响应不含 Markdown、Prompt、模型或未来编辑上下文。
- 蓝图已删除 Topic/GEO Source、Content Intent、audience、angle、conversion goal、format、length、generation/manual mode、notes、Prompt 和 AI model 等旧字段建议。
- `contracts/database.md`、Frontend V2 03/05/07/08 和 Trellis code-spec 已同步；无需 migration、新依赖、新 ADR 或 V1 运行时代码改造。

## 3. Required validation

| 检查 | 结果 |
| --- | --- |
| `make contract-check` | 通过；FastAPI/OpenAPI/V1/V2 generated types 一致 |
| Backend contract + PostgreSQL integration | 32/32 通过；覆盖资格、空态、排序、固定查询数、options 过期、幂等与并发唯一 |
| V2 component/unit | 24/24 通过 |
| `make lint` / `make typecheck` | 通过；backend、V1、V2 全部成功 |
| V2 production build | 通过；仅有既有 chunk-size warning |
| New Content Task fixture Playwright | desktop/mobile 20/20 通过；Content Task List desktop 6/6 通过 |
| Product Facts real-stack | Flow A/B 2/2 通过；Flow A 真实创建 ContentTask 并返回列表 |
| V1 targeted `ContentTasksPage.test.tsx` | 23/23 通过 |
| `git show --check 326df9f` | 通过 |

首次完整 V1 E2E 额外运行得到 49 passed / 3 failed；失败位于未修改的 AI 审计可见性、既有源码标记清单和不存在资源删除状态断言。最终缩小 orchestration 再次证明 V2 Flow A/B 通过，尾部 V1 shared-data setup 因本地 Celery 作业保持 `PENDING` 失败；这些 optional/环境证据没有触发无关修复。

## 4. Trellis-check 与 spec 归档

- 最终检查确认 write flow 为 Form → generated `ContentTaskCreate` → POST → advisory/row locks → PostgreSQL，read flow 为 PostgreSQL → fixed-query options → generated response → Content Form。
- 未发现手写第二 DTO、浏览器资格推导、Product domain 内部导入、通用 Form/options framework、调试日志、依赖新增或排除范围文件。
- `trellis-update-spec` 判断为需要：新增跨层 API 与 URL/幂等状态合同属于强制归档项。Backend database spec 补齐 endpoint、handoff 矩阵和测试点；Frontend state-management spec 补齐七段可执行合同。

## 5. Gate

- New Content Task implementation 与 required validation gate：`MET`。
- Task 仍保持 `in_progress`，等待 Trellis bookkeeping commit 确认后运行 finish-work、归档、快进合并到 `main` 并删除本地临时分支。
- 下一 Task 可独立规划 `frontend-v2-content-task-detail`；本次收尾不开始该工作。
