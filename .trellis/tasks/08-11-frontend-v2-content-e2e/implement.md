# Frontend V2 Content E2E — Implementation Plan

## 1. Preconditions

- [x] 用户批准本轮最终 `prd.md`、`design.md`、`implement.md`。
- [x] 批准后运行 `task.py start`；此前不修改测试、业务代码或直接文档。
- [x] 仅临时 stash 本 Task 目录（包含未跟踪规划文件），确认 primary working directory 位于最新、干净的 `main`；只在 clean tree 需要同步时运行 `git pull --ff-only origin main`。
- [x] 从该 `main` 创建用户已批准的临时分支 `codex/frontend-v2-content-e2e`，然后在分支上恢复本 Task 目录；不为清理 `main` 先创建计划提交。
- [x] 使用 `trellis-before-dev` 重读 task artifacts 与相关 frontend/infra specs。
- [x] 确认 `DATABASE_URL` 可创建独立 E2E database，`REDIS_URL` 指向本次运行独占且无其他 Worker/Scheduler 的 broker logical DB。

## 2. Ordered Implementation

### 2.1 Extend Existing Real-Stack Flow Owner

- [x] 在 `content-review-real-stack.spec.ts` 复用当前 `responseBody/login/createActivePlatform/createApprovedProduct/createReviewReadyTask/reviewContext`，不抽通用 helper。
- [x] 让 review-ready setup 在 manual draft 创建后再进行一次页面编辑/保存，再提交审核，确保 Flow A/B 都包含真实 save。
- [x] 为只读交叉验证增加本文件局部 generated types 与最小 GET helper；不新增 API mutation helper。

### 2.2 Flow A — Normal Closure

- [x] 保留现有页面 APPROVE 断言。
- [x] 从 Review 页面点击“返回任务详情”，不直接 `page.goto` 跳过 canonical navigation。
- [x] 在 Task Detail 断言批准状态、当前版本链接、`START_PUBLICATION` 和 `/publishing/work`。
- [x] 用最终 `ContentTaskDetail` 与 `ContentReviewContext` 只读 GET 交叉验证 `workflow_stage`、`primary_task`、`current_content_version_id` 与 approved current version。
- [x] 从 Task Detail 点击当前版本进入 Content Version Detail，断言同一 approved version、readonly DOM 与 `review_result=approve`。

### 2.3 Flow B — Request Changes and Revision Closure

- [x] 保留现有页面 REQUEST_CHANGES 与意见持久化断言，记录旧版本 ID 和不可变 payload。
- [x] 经 Review → Task Detail → Editor canonical links 进入 revision mode。
- [x] 从旧版本创建新的 HUMAN revision，随后通过页面再次修改并保存。
- [x] 通过页面 resubmit，返回 Task Detail，再进入 Review 并 approve。
- [x] 最终只读验证旧版本 payload 不变、新版本 `based_on_id/source_type/status`、Task pointer/`START_PUBLICATION`。
- [x] 从新版本 detail timeline 按 `target_id` / `target_version` 验证 v1 与 v2 的 submit/decision 记录没有串线。

### 2.4 Documentation and Scope Gate

- [x] 更新 `docs/frontend-v2/07`、`08` 与 `.trellis/spec/infra/e2e-isolation.md`，只记录已实际通过的 Flow 和 suite owner。
- [x] 不修改 fixture specs、AI spec、Version Detail spec、Playwright config、Makefile 或 orchestration。
- [x] 真实运行未暴露 Content canonical navigation/cache 小缺陷，也未触发公共 API/数据库/权限/状态机/read model 停止边界。

### 2.5 Check and Review

- [x] 按 required validation 顺序执行；同一失败在代码/配置/环境未变化时不重复运行。
- [x] 运行 `trellis-check`。
- [x] 自审最终 diff：无 fixture import、route mock、sleep、共享数据、第二 spec/helper/orchestration、新依赖或范围外修复。
- [x] 报告 outcome、changed files、validation、docs、风险与 branch 状态。
- [x] 提交前展示 commit plan 并等待确认；不 push。

## 3. Exact Required Validation

从最快的静态证明到唯一真实栈 gate 顺序执行：

```bash
cd /Users/sc/PycharmProjects/partsignal

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck

sh -n deploy/scripts/e2e-local.sh
python3 -m py_compile deploy/scripts/e2e-database.py

: "${DATABASE_URL:?必须指向可创建隔离 E2E database 的 PostgreSQL}"
: "${REDIS_URL:?必须指向本次运行独占的 Redis logical DB}"
redis-cli -u "$REDIS_URL" --raw DBSIZE
redis-cli -u "$REDIS_URL" --raw CLIENT LIST

deploy/scripts/e2e-local.sh tests/e2e/trusted-types.spec.ts

git diff --check
```

运行 `deploy/scripts/e2e-local.sh` 前必须人工/只读确认：目标 Redis logical DB 无业务 key，`CLIENT LIST` 中没有其他 Worker/Scheduler 使用该 DB；不自动 flush 共享 Redis，不终止未知进程。

真实栈 required 结果必须全部满足：

- V2 `foundation-desktop` real-stack 7/7 通过：Product Facts 3 条、AI Production 1 条、扩展后的 Content Flow A/B 2 条、Version Detail 1 条。
- Flow A/B 的 Product、Fact、ContentTask、draft/save/submit/review/revision/approve 均由页面发起。
- AI Production 继续实际经过 Celery/fake provider；新 Flow 不重复 AI。
- V2 使用 `vite preview :4174` 的 production artifact，不启动 V2 dev server。
- targeted V1 `trusted-types.spec.ts` 通过；若出现与当前 diff 无关的 V1 failure，保留日志并按失败归因规则处理，不修改无关代码。
- 退出日志同时包含 `E2E_CLEANUP database=... status=deleted` 与 `E2E_CLEANUP storage=... status=deleted`；任一清理失败使 gate 失败。

## 4. Optional Validation

```bash
make e2e
make verify
```

只有发布准备、Phase 3 全仓门禁或用户明确要求时运行。Optional failure 不自动进入修复范围；先证明与当前 diff 的因果关系。

## 5. Expected Files

### Planned

- `frontend-v2/tests/e2e/content-review-real-stack.spec.ts`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `.trellis/spec/infra/e2e-isolation.md`
- 当前 Trellis Task 的 `prd.md`、`design.md`、`implement.md`、workflow metadata

### Conditional only after direct failing evidence

- `frontend-v2/src/domains/content/content-task-actions.ts`
- `frontend-v2/src/domains/content/content-review-page.tsx`
- `frontend-v2/src/domains/content/content-editor-page.tsx`
- 对应 colocated tests

### Explicitly Not Expected

- 新 real-stack spec、`content.fixture.ts`、其他 fixture specs、`content-ai-real-stack.spec.ts`、`content-version-detail-real-stack.spec.ts`
- `deploy/scripts/e2e-local.sh`、Playwright config、Makefile、package manifests/lockfiles
- OpenAPI、database contract、migration、backend、generated API schema、V1 runtime/UI

## 6. Failure Attribution Matrix

| Failure | Current task action |
| --- | --- |
| Flow A/B selector 与页面实际 canonical control 不一致 | 先核对页面语义；只修 test，除非页面 link 真正错误 |
| Review 成功后返回 Detail 出现 stale projection | 定位 query invalidation；允许最小 Content cache 修复和直接测试 |
| request changes 后无法通过 primary action进入 revision | 定位 action registry/navigation；允许最小 canonical link 修复 |
| pointer、timeline target、不可变 payload 或状态机错误 | 停止；建议公共合同/状态机独立修复 Task |
| Redis 非独占、端口占用、服务未就绪 | 环境失败；换独占资源或报告所有者，不改产品代码 |
| targeted V1 / optional full suite 既有失败 | 报告并跳出修复范围，除非 diff 直接造成 |
| cleanup 失败 | gate 失败；先修当前脚本/环境归因，不把业务 test 通过当完成 |

## 7. Rollback Points

1. 回滚 `content-review-real-stack.spec.ts` 的扩展即可恢复原两条 decision-only test；无业务数据迁移。
2. 三份文档随真实证据原子回滚，禁止保留“完整闭环已通过”的漂移描述。
3. 如存在条件性 Content navigation/cache 小修，可独立回滚该 owner 与直接回归，不影响 E2E planning artifacts。
4. 本任务不得通过移除失败断言、跳过 Flow、降低到 API mutation 或修改 orchestration 来“回滚”真实业务失败。
