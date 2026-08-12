# Frontend V2 Phase 4 Publishing 完整真实栈 E2E

## Goal

在现有隔离真实栈中补齐 Phase 4 Publishing 的最终连续验收证据，证明 `PublicationWork`、`PublishedArticle`、`PublishedContentIssue` 三个独立资源生命周期通过 Frontend V2 UI 连续工作，且服务端动作投影、不可变快照和清理边界保持成立。

覆盖审计与规划已获用户批准；Task 已进入实施，仍不创建分支。

## 用户价值

- 将已经分散通过的 Content、Publication Workspace、Article readonly 与 Issue fixture 证据收束为可重复执行的 Phase 4 退出门禁。
- 防止测试通过 API 绕过 `START`、直接成功核验或发布后问题命令，从而误把组件能力当成连续真实业务能力。
- 在同一运行中证明发布成果、核验、事件、问题历史和来源 Markdown snapshot 不会被后续问题处理改写。

## 现有覆盖矩阵

| 生命周期节点 | 现有证据 | 证据级别 | 结论 |
| --- | --- | --- | --- |
| Content 人工稿 → submit → approve → `START_PUBLICATION` handoff | `content-review-real-stack.spec.ts` Flow A | UI + PostgreSQL/FastAPI production preview | 已证明批准内容和 handoff；未执行 START |
| Ready Queue `START`、账号选择、CSRF/幂等与 canonical work ID | `publication-work-list.spec.ts` | production-artifact fixture；backend 有 targeted PostgreSQL 边界 | 页面行为已证明，但没有 UI real-stack command |
| preparation → platform review → screenshot → register result | `publication-workspace-real-stack.spec.ts` Flow A（现有 131–183 行） | UI + PostgreSQL/FastAPI/对象存储 production preview | 已证明；当前由 API 预先创建 PublicationWork，且停在 `AWAITING_VERIFICATION` |
| direct PASSED → PublishedArticle | Flow B 最终 PASSED；独立 Article 用例用 API 建立完成聚合 | Flow B 为真实 UI，但经过 FAILED；Article 用例仅 GET | 原子成功与只读成果已分别证明；缺少不经过 FAILED 的连续直接成功链 |
| FAILED → ACTION_REQUIRED → Content revision/review/approval → switch → re-register → PASSED | `publication-workspace-real-stack.spec.ts` Flow B（现有 185–326 行） | UI + PostgreSQL/FastAPI production preview | 已完整证明，不重写、不新增第二条失败流 |
| Article list → readonly Detail 单 GET | 同 spec 的 Published Article 用例（现有 328–393 行） | 真实栈 GET-only | 已证明，不复制 |
| Article → open issue → create repair task → resolve | `published-content-issues.spec.ts` 27–64 行 | generated-type strict fixture | UI 合同已证明；缺少 PostgreSQL/FastAPI 连续真实栈证据 |
| database / object storage cleanup | `e2e-local.sh` 33–67 行及 `e2e-database.py` | trap + allowlisted deletion | 已有 owner；必须在本任务运行日志和事后只读检查中重新证明 |
| Redis isolation / cleanup | `e2e-local.sh` 仅消费外部 `REDIS_URL` 并停止本次 Worker/Beat | 独占 logical DB 由调用方负责 | 必须做运行前独占检查、运行后精确清理与空库断言；不得 flush 共享 Redis |

## 本任务唯一缺口

缺口是“成功发布到发布后问题处理”尚无一条由 UI 连续驱动的真实栈证据。它包含三个尚未在同一真实 flow 中成立的节点：UI `START`、不经过 FAILED 的直接 `PASSED`、Article → issue → repair → resolve。

最小交付是扩展现有 `publication-workspace-real-stack.spec.ts` 的 Flow A，而不是新增 spec 或重跑一份 Flow A/Flow B：

```text
API 前置 approved content / platform / accounts
→ UI Ready Queue START
→ UI preparation / platform review / screenshot / register result
→ UI PASSED verification
→ UI PublishedArticle handoff
→ UI open issue
→ UI create repair ContentTask
→ UI follow server primary task handoff
→ UI resolve issue
→ final read-only API assertions
```

现有 Flow B 只做一个边界收紧：删除中途 `workspace-context` 探针，改在 UI 的换版 Dialog 断言 candidate，并把所有 API 断言留到流程结束；其业务步骤和验收内容不变。

## Requirements

### R1 — 单一 orchestration 与数据隔离

- 只使用 `deploy/scripts/e2e-local.sh` 已有的临时 PostgreSQL、FastAPI、对象存储、Celery Worker/Beat、fake AI provider 和 V2 production preview 生命周期。
- 不新增脚本入口、fixture、通用 helper framework、数据库、seed、服务或清理器。
- 每条 flow 使用随机唯一业务数据；不依赖其他 spec 的实体或执行顺序。
- `REDIS_URL` 必须指向本次运行独占且运行前为空的 logical DB；存在其他 Worker/Scheduler 或业务 key 时停止，不得继续或清扫共享资源。

### R2 — API 与 UI 边界

- API mutation 只用于建立测试开始前的最小前置数据：登录、平台/账号、Product/Fact、approved Content，以及既有 Flow B/Article GET-only 用例所需的起始聚合。
- 扩展后的 Flow A 从 `START` 起的所有业务命令必须通过 Frontend V2 UI：START、preparation、platform review、result、PASSED、open issue、create repair task、resolve。
- Flow 进行中不得用 API response 决定按钮、候选、ID 或下一步；身份从 canonical URL、页面链接和服务端投影的 UI 呈现取得。
- API 只在业务 flow 结束后执行只读断言；不通过 `page.route`、fixture 或测试代码直接调用命令 endpoint。

### R3 — 服务端动作投影

- Ready Queue 只因服务端 `START` action 显示入口；创建后从 active work row 的“继续准备”进入 Workspace。
- Work 的准备、登记、核验和完成 handoff 只使用 `primary_task` / `available_actions` 映射出的控件。
- Article 只有服务端返回 `OPEN_ISSUE` 时显示“登记内容问题”。
- Issue 无 repair task 时显示 `CREATE_REPAIR_TASK` 主动作；创建后 Issues List 显示 `CONTINUE_REPAIR` canonical link，repair ContentTask Detail 显示 `CREATE_FIRST_DRAFT`，并可从来源上下文返回同一 Issue。
- Issue 在 repair task 仍为 `OPEN` 时只保留 `RESOLVE` 可执行命令；解决后 `VIEW_RESOLUTION` 且无写动作。

### R4 — 不可变与历史断言

- 最终 `PublicationWorkspaceContext` 只有一个 PASSED verification，绑定原 approved ContentVersion；events 精确为 `CREATED → PREPARATION_UPDATED → PLATFORM_REVIEW_MARKED → RESULT_REGISTERED → COMPLETED`。
- `PublishedArticle.id == PublicationWork.id`；actual title、final URL、published time、平台/账号 snapshot、content ID/hash、PASSED verification snapshot、来源 Markdown/summary/tags、Fact/review lineage 和 Publication events 与发布完成时事实一致。
- Issue 的 kind、description、article identity、opened identity 保持不变，只追加合法 `OPEN → RESOLVED`、resolution outcome/comment/actor/time/revision。
- Article 的 issue history 包含同一 resolved issue；issue Workspace 的嵌套 Article、verification、events 和 source content 与最终 Article detail 一致。
- repair ContentTask 保持独立 `OPEN / NO_DRAFT / CREATE_FIRST_DRAFT`，`source_published_content_issue_id` 指向该 issue；resolve 不修改或完成 repair task。

### R5 — Scope discipline

- 不修改生产代码、OpenAPI、数据库、migration、依赖或 `deploy/scripts/e2e-local.sh`。
- 不修改 `published-content-issues.spec.ts`、既有 fixture、Flow B 业务路径或独立 Article GET-only 用例。
- 若扩展后的测试暴露生产行为、合同或 orchestration 缺陷，停止并报告；不在本任务顺手修复，另行决定是否创建修复 Task。
- 不进入 Phase 4 vertical-slice 抽象回顾、GEO、Workbench、Cutover 或后续阶段。

## Acceptance Criteria

- [x] AC1：Flow A 通过 UI 从 Ready Queue `START` 开始，完成 preparation、platform review、带真实对象存储截图的 result registration 和直接 PASSED verification。
- [x] AC2：Flow A 从完成 Workspace 的 canonical link 进入同 ID PublishedArticle，再通过 UI 完成 open issue、create repair ContentTask、server-driven repair handoff 和 explicit resolve。
- [x] AC3：Flow A 从 START 起没有业务 API mutation，也没有中途 API 探针；最终只读断言覆盖 Work、Article、Issue Workspace 和 repair task。
- [x] AC4：最终 Work verification/event、PublishedArticle result/source snapshot、Issue history 和 repair source identity 满足 R4，且所有终态页面无非法写入口。
- [x] AC5：现有 Flow B 仍完整覆盖 FAILED → ACTION_REQUIRED → revision/review/approval → switch → re-register → PASSED，且不复制、不改变业务语义。
- [x] AC6：独立 PublishedArticle list/detail GET-only 用例保持通过；fixture 页面矩阵不重复进真实栈 flow。
- [x] AC7：测试继续由 `e2e-local.sh` 在 `foundation-desktop` production preview 中运行，无新 orchestration、fixture、依赖或 runtime 文件。
- [x] AC8：成功与失败退出均执行清理；日志包含 database/storage `status=deleted`，事后无 `partsignal_e2e_%` 数据库、无临时存储目录，本次独占 Redis logical DB 为空且无本次 Worker/Beat 客户端。
- [x] AC9：`docs/frontend-v2/07-migration-plan.md`、`08-testing-quality-and-acceptance.md` 与 `.trellis/spec/infra/e2e-isolation.md` 只在真实门禁通过后更新为实际证据。
- [x] AC10：验证未发现真实产品或 harness 缺陷，且未修改生产实现或放宽业务断言。

## Out of Scope

- 重写或复制 Publication Workspace Flow B、PublishedArticle GET-only 用例、Content real-stack flows 或 fixture 页面矩阵。
- repair ContentTask 的 draft/review/approval；本生命周期只要求创建独立 repair task 并显式解决 issue。
- 新 E2E framework、第二套 orchestration、共享 fixture 抽象、生产修复、合同/数据库/依赖变更。
- Phase 4 抽象回顾、GEO、Workbench、Cutover 与任何后续阶段。

## Blocking Open Questions

无。用户已显式批准实施。
