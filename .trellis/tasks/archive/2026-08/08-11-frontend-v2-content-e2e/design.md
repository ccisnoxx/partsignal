# Frontend V2 Content E2E — Design

## 1. Coverage Audit 结论

当前 Content 证据覆盖了每张页面和多个真实能力，但完整业务链在关键边界处被切断：正常流程未从 approve 回到 Task/Version/publication handoff；退回流程未继续到 HUMAN revision、重新送审和批准。最小方案是扩展现有 Content Review real-stack 两条流程，而不是新增 spec 或重写已有测试。

### 1.1 当前 Content E2E Coverage Matrix

| 能力 / 页面 | fixture / component 证据 | real-stack 证据 | 当前判断与真正缺口 |
| --- | --- | --- | --- |
| Content Task List | `content-task-list.spec.ts:5-165`：服务端 projection、URL、lifecycle、错误、四档响应式与键盘 | 后续真实流程从 Product Detail 进入 New Task，不依赖列表创建业务数据 | 页面矩阵充分；完整闭环不需要重复列表状态测试 |
| New Content Task | `new-content-task.spec.ts:27-251`：三字段合同、handoff、幂等、DirtyGuard、canonical Detail | `product-facts-real-stack.spec.ts:127-207` 与 `297-367`、`content-review-real-stack.spec.ts:98-153` 均通过 V2 页面创建真实任务 | 创建证据充分；不是缺口 |
| Content Task Detail | `content-task-detail.spec.ts:7-121`：single read model、primary/overflow、canonical links、错误与响应式 | Product Facts Flow A 验证创建后真实 Product/Fact/Platform 与 `CREATE_FIRST_DRAFT` | approve 后未回到 Detail 验证 `APPROVED/current_content_version_id/START_PUBLICATION` |
| Editor Core | `content-editor.spec.ts:6-364`：manual/revision/save/submit、不可变边界、cache/DirtyGuard | Product Facts Flow C `product-facts-real-stack.spec.ts:297-367` 完成 manual → save → submit；Content Review setup `:98-153` 完成 manual → submit | 首次人工链充分；退回后真实 revision → save → resubmit 尚未证明 |
| AI Production | `content-editor.spec.ts:60-127,188-238`：按需 options/detail、polling、retry、humanization | `content-ai-real-stack.spec.ts:245-402`：真实 Worker、generation、humanization、timeout、exact snapshot retry、源版本不可变 | 证据充分；新闭环不重复 AI |
| Content Review | `content-review.spec.ts:6-194`：单一 context、approve/request changes、409/request ID、响应式与键盘 | `content-review-real-stack.spec.ts:156-201`：两条独立流程分别到 approve 和 request changes | Flow A 缺 approve 后交接；Flow B 缺退回后的完整修订闭环 |
| Content Version Detail | `content-version-detail.spec.ts:11-156`：single GET、六状态、HUMAN/AI、只读、错误与四档响应式 | `content-version-detail-real-stack.spec.ts:131-168`：API-prepared 独立 HUMAN 当前版本只读读取 | 未从同一批准流程进入 approved version；未交叉验证多版本 review target 关联 |
| Real-stack harness | `deploy/scripts/e2e-local.sh:70-128`：独立数据库、migration/seed、FastAPI、Worker/Beat、fake AI、V2 build/preview、统一 cleanup | 当前 3 Product Facts + 1 AI + 2 Review + 1 Version Detail test 都由同一入口运行 | orchestration 已满足；无需第二套脚本或新入口 |

### 1.2 已有连续证据与断点

```text
Product Facts Flow C
create Product/Fact → approve Fact → create ContentTask → manual → save → submit
                                                                     └─ 断在审核前

Content Review APPROVE flow
create Product/Fact/Task → manual → submit → approve
                                               └─ 缺 Task Detail / Version Detail / START_PUBLICATION

Content Review REQUEST_CHANGES flow
create Product/Fact/Task → manual → submit → request changes
                                                       └─ 缺 revision / save / resubmit / approve

Content Version Detail real-stack
API 建立独立版本 → readonly page
└─ 证明读取能力，但不证明同一批准链路
```

## 2. Spec 决策

### 2.1 结论

**扩展 `frontend-v2/tests/e2e/content-review-real-stack.spec.ts`，不新增 spec。**

理由：

- 现有两个 test 已经拥有 Flow A / Flow B 所需的独立随机 Product、Fact、Platform、ContentTask 和首次 draft。
- 该 spec 已通过所有 V2 页面到达 approve / request changes，扩展尾段即可得到真正连续的业务证据。
- `deploy/scripts/e2e-local.sh` 已显式运行该 spec；扩展后无需修改 orchestration 或 Makefile。
- 新建 `content-e2e-real-stack.spec.ts` 会复制 setup、增加运行时间并留下两个相近 owner；抽通用 helper 又违反本任务边界。

### 2.2 不修改的既有证据

- `content.fixture.ts` 及六个 Content fixture specs：不改、不导入、不重复矩阵。
- `product-facts-real-stack.spec.ts`：保留 Flow C 作为独立 Editor Core 证据。
- `content-ai-real-stack.spec.ts`：保留 AI/Celery/fake provider 专项证据。
- `content-version-detail-real-stack.spec.ts`：保留独立 readonly read-model 证据。
- `deploy/scripts/e2e-local.sh`：当前已运行目标 spec 与 production preview，预计无需修改。

## 3. Architecture and Boundary

```text
deploy/scripts/e2e-local.sh
  ├─ process-unique PostgreSQL database
  ├─ seed admin / engineer
  ├─ FastAPI + object storage
  ├─ exclusive Redis URL → Celery Worker + Beat
  ├─ fake AI provider
  ├─ frontend-v2 production build → vite preview :4174
  └─ Playwright real-stack specs (workers=1)
       ├─ Product Facts / Editor Core
       ├─ AI Production
       ├─ Content Review（本任务扩展为 Flow A / B）
       └─ Content Version Detail
```

- 两条新增闭环是 manual Content flows，不直接创建 AI job；Celery/fake provider 由同一生命周期内既有 AI spec 实际使用。
- Platform/PlatformType 仍可通过 API 创建，因为 V2 管理页面尚未迁移；Product、Fact、Task 与所有 Content mutation 必须通过页面。
- 最终只读交叉验证使用现有 `ContentTaskDetail`、基础 `ContentVersion` 和 `ContentVersionDetail`，不新增 read model 或 DTO。
- Playwright 依赖页面可见状态、URL 和 TanStack Query canonical refetch；不增加 `waitForTimeout` 或业务 sleep。

## 4. Flow A — 正常闭环设计

### 4.1 页面路径

```text
/products/new
→ /products/$productId/facts
→ /products/$productId/facts/review
→ /products/$productId
→ /content/tasks/new?productId=...
→ /content/tasks/$taskId
→ /content/tasks/$taskId/editor
→ /content/tasks/$taskId
→ /content/tasks/$taskId/review
→ /content/tasks/$taskId
→ /content/versions/$approvedVersionId
```

### 4.2 状态转换与断言

| 步骤 | 页面业务动作 | 服务端 canonical 状态 |
| --- | --- | --- |
| 创建任务 | V2 New Task POST | Task `NO_DRAFT / CREATE_FIRST_DRAFT`，pointer `null` |
| 创建人工首稿 | Editor manual version | HUMAN `DRAFT` 成为 current |
| 编辑并保存 | Editor save | 同一 HUMAN DRAFT payload 更新，revision 前进 |
| 提交审核 | Editor submit | current `PENDING_REVIEW`，Task `REVIEW_PENDING / REVIEW_CONTENT` |
| 批准 | Review approve | current `APPROVED`，Task `APPROVED / START_PUBLICATION` |
| 返回详情 | Review → canonical Task Detail | 页面展示批准版本、`START_PUBLICATION` 与 `/publishing/work` |
| 打开版本 | Task Detail current version link | 同一批准版本只读，review result 为 `approve` |

页面断言负责证明导航和可见交接；最终 API GET 只读交叉验证 `workflow_stage`、`primary_task`、pointer、version ID/status 和 review result。

## 5. Flow B — 退回修订闭环设计

### 5.1 页面路径

```text
独立 Product/Fact/Task
→ Editor 创建 v1 / submit
→ Review request changes
→ Task Detail
→ Editor 从 v1 创建 HUMAN v2
→ 编辑 v2 / save / submit
→ Task Detail
→ Review approve
→ Task Detail
```

### 5.2 状态转换

| 阶段 | v1 | v2 | Task pointer |
| --- | --- | --- | --- |
| 首次提交 | `PENDING_REVIEW` | 不存在 | v1 |
| 退回 | `CHANGES_REQUESTED` | 不存在 | v1 |
| 创建 revision | 保持不可变 | HUMAN `DRAFT`, `based_on_id=v1` | v2 |
| 保存 / 重新提交 | 保持不可变 | `PENDING_REVIEW`，revision 前进 | v2 |
| 批准 | 保持 payload 与目标审核记录不变 | `APPROVED` | v2 |

### 5.3 Review timeline 关联证明

最终读取 v2 `ContentVersionDetail.review_timeline`，按 `target_id` 分组：

- v1 只能得到 `submit-review`、`request-changes`，每条 `target_version=1`；
- v2 只能得到 `submit-review`、`approve`，每条 `target_version=2`；
- 不接受把 v1 的退回记录错误挂到 v2，或把 v2 的批准记录错误挂到 v1。

旧版本不可变性比较仅覆盖业务 payload 与来源字段；审核导致的 `status/revision/updated_at` 是合法状态转换，不应被误判为 payload 修改。

## 6. Data Isolation

| 维度 | Flow A | Flow B | 隔离方式 |
| --- | --- | --- | --- |
| suffix | `randomUUID().slice(0, 8)` | 独立随机 suffix | 名称、slug、part number、comment 均带 suffix |
| PlatformType/Profile | 独立创建 | 独立创建 | 仅允许的 API 前置数据 |
| Product/Fact | 页面创建 | 页面创建 | 不复用 Product Facts/AI/Version Detail spec 数据 |
| ContentTask/version | 页面创建 | 页面创建 | 每条 Flow 自有 pointer 与 review history |
| PostgreSQL | 同一 test run 专属数据库 | 同左 | 脚本创建/迁移/最终 drop；不逐记录清理 |
| Redis | 本次运行独占 `REDIS_URL` | 同左 | API、Worker、Beat 使用同一独占 broker；不连接共享 worker |
| AI | 本 Flow 不创建 job | 本 Flow 不创建 job | 同一运行中的 AI spec 使用自己的唯一 channel/model/task |

## 7. Canonical Navigation Audit

现有页面已经提供闭环所需的 canonical link：

- Task Detail `CREATE_FIRST_DRAFT / EDIT_AND_SUBMIT_REVIEW / REVISE_CONTENT` → `/content/tasks/$taskId/editor`；
- Task Detail `REVIEW_CONTENT` → `/content/tasks/$taskId/review`；
- Review / Editor → `/content/tasks/$taskId`；
- Task Detail current/activity version → `/content/versions/$versionId`；
- Version Detail → `/content/tasks/$taskId`；
- approved Task `START_PUBLICATION` → `/publishing/work`。

本任务先用测试证明这些链接连续工作；只有测试暴露直接可归因的 link 或 cache invalidation 小缺陷时才修改对应 Content domain 文件。

## 8. Expected Modified Files

### 必然修改

- `frontend-v2/tests/e2e/content-review-real-stack.spec.ts`：扩展现有两条真实流程。
- `docs/frontend-v2/07-migration-plan.md`：记录 Content Review 已完成与 Phase 3 完整 E2E 结果，不提前宣布抽象回顾完成。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`：登记两条完整 Content real-stack flow 与已有 AI/fixture 证据分工。
- `.trellis/spec/infra/e2e-isolation.md`：把真实栈门禁从独立 review decision 更新为完整 Flow A / B，并列出 Version Detail spec。

### 仅在测试给出直接证据时修改

- `frontend-v2/src/domains/content/content-task-actions.ts`
- `frontend-v2/src/domains/content/content-review-page.tsx`
- `frontend-v2/src/domains/content/content-editor-page.tsx`
- 对应 colocated component tests

预计不修改 `deploy/scripts/e2e-local.sh`、OpenAPI、database contract、backend、generated schema、fixture specs、AI spec 或 Version Detail spec。

## 9. Risks, Failure Attribution and Rollback

| 风险 / 失败 | 归因与处理 | 回滚点 |
| --- | --- | --- |
| approve 后 Detail 仍显示旧 cache | 若可复现且属于 Review invalidation，做最小精准失效修复；不加强制 reload fallback | 回滚 Content cache 小修与对应 test |
| request changes 后 Editor 未进入 revision mode | 先核对 canonical action/pointer；仅修复直接导航或 cache 缺陷 | 回滚页面小修，保留失败 spec |
| timeline target 错绑、pointer 错误或状态机不允许流程 | 属公共状态/数据合同问题，停止并建议独立 Task | 当前 Task 保留 failing evidence，不修改合同/backend |
| Redis 非独占或外部 Worker 连接 | 环境失败，停止运行并换独占 URL；不得继续或终止未知进程 | 无代码回滚 |
| V1 targeted / optional full-suite 失败 | 只有 diff 归因到本任务才修；其他失败报告但不扩范围 | 不修改无关 V1 |
| 运行时增加导致超时 | 先用页面可观察状态定位真实慢点；仅在实际需要时调整该 spec timeout，不加 sleep | 回滚 timeout 调整 |

核心回滚是恢复 `content-review-real-stack.spec.ts` 与三份直接文档；本任务没有 schema、数据迁移、公共 API 或长期进程变更。
