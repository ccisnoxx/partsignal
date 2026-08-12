# Frontend V2 Phase 4 Publishing 完整真实栈 E2E — 技术设计

## 1. 设计结论

不新增 E2E spec。扩展现有 `frontend-v2/tests/e2e/publication-workspace-real-stack.spec.ts` 的 Flow A，使它成为唯一连续成功链；现有 Flow B 继续承担失败核验链，独立 PublishedArticle 用例继续承担严格 GET-only read-model 边界。

```text
Flow A（扩展）
approved content precondition
  → /publishing/work Ready Queue
  → START
  → active row primary: CONTINUE_PREPARATION
  → preparation / platform review / result / PASSED
  → /publishing/articles/$workId
  → OPEN_ISSUE
  → /publishing/issues/$issueId
  → CREATE_REPAIR_TASK
  → Issues List primary: CONTINUE_REPAIR
  → /content/tasks/$repairTaskId
  → source Issue link
  → RESOLVE
  → terminal read-only assertions

Flow B（保留）
FAILED → ACTION_REQUIRED → Content revision/review/approval
  → switch → re-register → PASSED

Published Article（保留）
API prerequisite aggregate → browser list/detail GET-only
```

这是一项证据拼接，不是产品功能设计；生产实现、合同和 orchestration 均保持不变。

## 2. Flow A 前置数据与 helper 调整

现有 `createPrerequisites()` 在最后直接 `POST /publication-works`，导致 Flow A 无法证明 UI START。最小调整：

1. 让公共前置 helper 只创建并返回 `approvedContent`、批准 Fact、domain、first/second account 和 task identity。
2. Flow A 不调用 publication command API；从 Ready Queue 找到唯一标题对应 card，点击其“开始发布”，明确选择 first account。
3. Flow B 与独立 Article 用例仍可在各自测试开始前用一个小的局部 helper/API call 创建所需 PublicationWork；这属于既有 flow 的前置聚合，不改变其业务证明。

不引入 fixture builder/class/options framework。若两处 Work 前置请求形成真实重复，只提取一个文件内函数；不创建跨 spec helper。

## 3. 精确 UI 流程

### 3.1 Direct success 与 PublishedArticle

1. API 登录并创建随机 PlatformType、PlatformProfile、两个 active accounts、Product、approved Fact、ContentTask 和 approved ContentVersion；此时没有 PublicationWork。
2. 浏览器进入 `/publishing/work?page=1&pageSize=20`，在包含唯一 approved title 的 Ready card 中确认只有 server-projected “开始发布”。
3. 打开 START Dialog，选择 `首发账号`，点击“确认开始”；从页面成功提示取得 canonical work ID，并从包含该 title 的 active work row 点击“继续准备”，不调用 API 查 ID。
4. 在 Workspace 更新为 `复核账号`、标记平台处理中、上传真实 PNG 到临时对象存储、登记 result。
5. 页面显示“首次核验”/“核验发布结果”后，选择“一致，通过本次核验”，提交唯一说明。
6. 页面进入 terminal readonly，点击“前往发布成果详情”；断言同 ID Article、只读 badge、来源 content hash/Markdown 与 `OPEN_ISSUE` 驱动的“登记内容问题”。

### 3.2 Post-publication Issue

1. 在 Article Detail 选择 `CONTENT_CHANGED`，填写唯一 description，通过 UI 登记；从 canonical URL 取得 issue ID。
2. Issue Workspace 必须同时显示“创建修复任务”和次级“解决内容问题”，证明 no-task 投影为 `HANDLE_CONTENT_ISSUE + [CREATE_REPAIR_TASK, RESOLVE]`。
3. 点击“创建修复任务”；只有此时浏览器读取 `repair-context`。选择前置 approved FactVersion 并确认。
4. Workspace 刷新后显示 repair task link 和“修复中”；进入 Issues List，在唯一 issue row 断言主入口“继续修复”指向该 repair task。
5. 点击“继续修复”，在 Content Task Detail 断言 `CREATE_FIRST_DRAFT`、无 current content、来源 Published Content Issue link 指回同一 issue；点击该来源链接返回 Workspace。
6. 点击“解决内容问题”，选择 `RESTORED`，填写说明并确认；断言页面为“已解决”、显示只读 resolution、repair task 状态仍为 OPEN，且所有 issue command 消失。

不创建 repair draft。创建 repair task 与 issue resolution 是两个独立命令，任务是否完成不决定 issue 是否可解决。

## 4. API 边界

### 4.1 允许的前置 mutation

- `POST /auth/login`；
- PlatformType/Profile/Account 创建；
- Product、Fact draft/submit/approve；
- ContentTask、manual ContentVersion、submit/approve；
- 仅既有 Flow B 与 Article GET-only 用例的 PublicationWork/result/verification 前置。

这些请求全部发生在目标 flow 开始前。扩展 Flow A 的 `POST /publication-works`、PATCH/POST/PUT Work commands 和 Issue commands均必须来自页面网络请求。

### 4.2 允许的最终只读断言

Flow A 完成 resolve 后才读取：

```text
GET /api/v1/publication-works/{work_id}/workspace-context
GET /api/v1/published-articles/{work_id}
GET /api/v1/published-content-issues/{issue_id}/workspace-context
GET /api/v1/content-tasks/{repair_task_id}/detail   # 仅当 Workspace 的 ContentTaskOut 不足以证明 Detail handoff
```

测试不得在 START、switch candidate、repair candidate 或 issue resolve 之间用 API 决定下一步。Flow B 当前中途读取 `candidateContext` 的断言移到 UI Dialog 与最终 Context：Dialog 证明 server candidate title/hash，最终 Context 证明选中的 content ID、FAILED/PASSED snapshots 和 event lineage。

## 5. 最终不可变断言

### PublicationWork

- `status=COMPLETED`、`primary_task=VIEW_COMPLETION`、无 mutation actions；
- content ID/hash 等于前置 approved ContentVersion；
- verifications 精确一条 PASSED，title/URL/published time snapshot 等于 UI 登记值；
- events 精确为 `CREATED, PREPARATION_UPDATED, PLATFORM_REVIEW_MARKED, RESULT_REGISTERED, COMPLETED`；
- verified screenshot 仍存在且只关联该 Work。

### PublishedArticle

- Article/Work 同 ID；结果、冻结平台/账号、content ID/hash 与 verification 一致；
- `source_content.content` 的 title/summary/body/tags/hash/version/fact identity 等于前置 approved snapshot；
- `verification` 与 Work 的 PASSED verification 深度相等；
- `events` 与 Work events 深度相等；
- `issues` 只有本次 resolved issue，kind/description/opened identity 未被 resolve 改写，resolution fields 完整追加。

健康、`open_issue_id`、`primary_task` 和 issue history 是合法派生变化，不纳入 PublishedArticle immutable payload 的错误全对象比较。

### PublishedContentIssue / repair task

- `status=RESOLVED`、`revision=1`、`primary_task=VIEW_RESOLUTION`、`available_actions=[]`；
- `resolution_outcome=RESTORED`，comment/actor/time 非空且 description/kind/article ID 不变；
- Workspace 嵌套 Article 的 immutable payload、verification、events、source content 与 Article detail 相同；
- repair task `status=OPEN`、`workflow_stage=NO_DRAFT`、`primary_task=CREATE_FIRST_DRAFT`、`current_content_version_id=null`、source issue/fact/platform identity 正确。

## 6. Orchestration 与 cleanup

`deploy/scripts/e2e-local.sh` 已是唯一 owner：

- allowlisted 临时 PostgreSQL database；
- `mktemp` 对象存储与 Celery beat 文件；
- FastAPI、dev storage、fake AI、Worker/Beat、V1/V2 preview 进程；
- V2 real-stack spec 固定列表，其中已经包含目标 publication spec。

本任务不修改脚本。需要补的是验收程序：

1. 运行前确认 `REDIS_URL` 指向专用 logical DB、`DBSIZE=0`，且 `CLIENT LIST` 无其他 Worker/Scheduler。
2. 将完整输出保存到临时日志；即使测试失败，trap 仍必须输出 database/storage `status=deleted`。
3. 运行后只读查询 PostgreSQL，不得残留 `partsignal_e2e_%` database；检查日志中的 storage 路径已不存在。
4. 本次 Worker/Beat 停止后，对已确认专用的 Redis logical DB执行精确 cleanup，并断言 `DBSIZE=0`、无本次客户端。绝不对共享 Redis 执行 `FLUSHDB`。

若 database/storage/Redis 任一 cleanup 不成立，整个 gate 失败，即使业务 test 通过也不能验收。

## 7. 预计修改文件

### 实施文件

- `frontend-v2/tests/e2e/publication-workspace-real-stack.spec.ts`：唯一测试代码改动；扩展 Flow A，并收紧 Flow B 的 API 断言时点。

### 真实门禁通过后更新的权威证据

- `docs/frontend-v2/07-migration-plan.md`：将 Phase 4 第 5 项记录为已完成，保留第 6 项抽象回顾未开始。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`：新增 Publishing 完整真实栈闭环的实际 flow、边界和清理证据。
- `.trellis/spec/infra/e2e-isolation.md`：把已存在的 Publishing real-stack gate 与最终 Issue lifecycle 纳入稳定 isolation contract；不改变脚本行为。

### 不修改

- `deploy/scripts/e2e-local.sh`、`deploy/scripts/e2e-database.py`；
- `published-content-issues.spec.ts`、`publication.fixture.ts`；
- frontend/backend runtime、OpenAPI、database contract、migration、generated types、package manifests；
- backend/frontend publication/state specs（当前合同已覆盖本 flow，无新 invariant）。

## 8. 风险与停止条件

| 风险 / 失败 | 归因与处理 |
| --- | --- |
| UI START 不出现或创建失败 | 先核对 Ready projection 与前置数据；若合同真实不成立，记录产品缺陷并停止，不用 API 绕过 |
| direct PASSED 不创建同 ID Article | Publication 状态机/事务缺陷；停止，不改生产代码 |
| Issue open/repair/resolve 与 fixture 不一致 | 产品或 read-model 缺陷；停止，不放宽断言、不补 mock |
| source/verification/event 在 Issue 命令后变化 | 不可变合同缺陷；停止并保留最终 payload 证据 |
| 既有 Flow B 失败 | 只有证据指向本次测试重构才修；否则记录既有/环境失败，不扩张 scope |
| AI/Content/V1 其他 spec 失败 | 与目标 flow 分开归因；不重复运行同一失败，不修改无关代码 |
| cleanup 失败 | harness/environment gate 失败；先完成精确资源清理并报告，不宣称业务验收完成 |

## 9. 回滚点

- 代码回滚点：实施开始前 `main` 的精确 commit；本任务无分支、migration、外部发布或持久数据变更。
- 测试回滚单元：`publication-workspace-real-stack.spec.ts` 的单文件变更；证据文档只在门禁通过后提交，可与测试作为同一原子提交回滚。
- 运行时回滚：删除本次 allowlisted database、临时 storage、停止本次进程并清空已确认专用的 Redis logical DB；不触碰共享环境。
