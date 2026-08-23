# Frontend V2 Workbench E2E 审计

## 1. 仓库与依赖结论

- 创建任务前仓库位于 clean `main`；未执行 pull、push、PR 或历史改写。
- Aggregate Read Model 已由 `545ecde2` 实现、`13f2449b` 归档；Workbench UI 已由 `59e9e76b` 实现、
  `d3603678` 归档。两个 archived `task.json.status` 均为 `completed`，parent 均指向 Phase 8 父任务。
- 本任务已通过 `task.py create --parent 08-23-frontend-v2-phase-8-workbench-planning` 成为第三个 child，状态仍为
  `planning`；尚未创建分支或运行 `task.py start`。
- 当前没有 blocker：四个既有 spec 均能自然建立所需状态。

## 2. Workbench 当前实现证据

- `workbench.api.ts` 只有 `workbenchKeys.aggregate()`，query function 只调用 `GET /api/v1/workbench`；无 mutation、
  轮询或跨域 join。
- `/` route 与 `WorkbenchPage` 共享同一个 query options；页面按 `data-workbench-count` 渲染六类 count，attention
  anchor 直接使用 response `href`。
- `workbench.model.ts` 只做 typed label/rate/date 映射；`value === null` 显示“暂无数据”，合法 `0` 显示 `0%`。
- `workbench.fixture.ts` 与 `workbench.spec.ts` 已独立证明 production artifact 每次 direct navigation 只有一个
  Workbench business GET，任何 Product/Content/Publication/GEO join 都失败，并覆盖 canonical href、键盘和四档
  响应式。本任务不复制该 strict allowlist。
- real-stack config 固定 `fullyParallel: false`、`workers: 1`，真实栈统一 `trace: off`；未配置 video/screenshot，
  reporter 为 list。`page.goto('/')` 是完整 document navigation，会重建 QueryClient 并取得新的 aggregate，避免
  30 秒 stale cache 让连续 Publication/GEO 检查点读取旧响应。

## 3. 精确自然检查点

### Product Facts

- Owner：`product-facts-real-stack.spec.ts` Flow A。
- 当前插入点：`enterFactsAndSubmit(...)` 后、`openProductsList(...)` 前（当前约第 138 行）。
- 已有状态：唯一 `FactVersion=PENDING_REVIEW`；标题投影为 `PartSignal E2E {partNumber}`，item href 为
  `/products/{productId}/facts/review`。
- 最小调整：以 Workbench attention navigation 替代原 List → row → 审核入口，不改变后续批准与 handoff 断言。

### Content Review

- Owner：`content-review-real-stack.spec.ts` Flow A。
- 当前插入点：`createReviewReadyTask(...)` 返回后、`reviewContext(...)` 与批准前（当前约第 201 行）。
- 已有状态：当前 ContentVersion 为 `PENDING_REVIEW`，task stage 为 `REVIEW_PENDING`；唯一标题为
  `{partNumber} 审核内容`，item href 为 `/content/tasks/{taskId}/review`。
- attention navigation 返回原 Review Workspace 后继续既有批准流程，不复制 draft/submit workflow。

### Publication

- Owner：`publication-workspace-real-stack.spec.ts` Flow A；不使用 Published Article API-only 用例或新 flow。
- `PREPARING`：UI START 返回 `workId` 后、原 `continuePreparation.click()` 前（当前约第 161 行）；item href 为
  `/publishing/work/{workId}#preparation`。
- `AWAITING_VERIFICATION`：登记真实发布结果成功后、点击“核验发布结果”前（当前约第 199 行）；item href 为
  `/publishing/work/{workId}#verification`。
- `OPEN issue`：UI 登记问题取得 `issueId` 后、创建 repair task 前（当前约第 231 行）；此时服务端 primary task
  为 `HANDLE_CONTENT_ISSUE`，item title 仍为来源 `setup.approvedContent.title`，href 为
  `/publishing/issues/{issueId}#repair`。
- 三次都复用同一 work/article/issue，不额外创建 Publication workflow。

### GEO

- Owner：`geo-real-stack.spec.ts` Flow A。
- root 检查点：UI 创建 `PARTIAL` root 并完成 Detail 断言后、打开 Correction 前（当前约第 364 行）。root 是
  current tail，item title 为唯一 `rootQuery`，href 为 `/geo/observations/{root.id}`。
- correction 检查点：追加 `UNJUDGEABLE` correction 并完成 Detail 断言后、进入 List 前（当前约第 413 行）。
- 同一 chain 的 issue count 前后精确减少 `1`，root attention 消失；rate 从 root 的 `1/1, 0/1, 0/1` 转为
  tail 的 `0/1, 0/1, 0/0(null)`，直接证明只统计 current tail 且未知准确率不是零。

## 4. Count 与跨 spec 隔离

- 四条 Required Validation 命令各自创建新的 allowlisted PostgreSQL 数据库和临时 storage；Playwright 单 worker，
  spec 之间无数据依赖。
- Product/Content/Publication 不断言绝对 count；断言 count 为正，并用唯一 synthetic title/resource ID 与精确
  canonical href 证明本场景已进入 aggregate。
- GEO 不断言共享绝对 count，而保存 root 检查点数值并在 correction 后断言减 `1`；rate 只使用该 spec 第一个
  current-window manual chain。
- recent attention 最多 10 条；当前每个定向 owner 都从 fresh database 开始，目标 flow 是首个对应状态，唯一
  synthetic title 可稳定定位，不依赖其他 spec 顺序。

## 5. Sensitive output 与 cleanup

- 新断言只读取 count 数字、synthetic title、rate 文案与 relative href；不监听或序列化 request header/body，
  不输出 response payload、password、Cookie、CSRF、storage state 或 Markdown 正文。
- real-stack trace 由 `frontend-v2/playwright.config.ts` 统一关闭；本任务不覆盖 trace、reporter、video、screenshot
  或 `secret-artifact.ts`，不放宽任何既有 secret scan。
- 不新增失败 wrapper；因此不会把现有 `responseBody()` 的响应正文日志模式扩展到 Workbench 请求。若需要扫描测试
  产物，只复用既有 `expectSecretsAbsent`，不创建第二个 secret helper。
- 每个 `e2e-local.sh` 运行必须保留 database `status=dropped`、storage `status=removed`、Redis
  `status=deleted`、port `status=released`，并确认本次进程均已 stop/wait。任一 cleanup 非零即该 owner 失败。

## 6. 文档结论

`docs/frontend-v2/08-testing-quality-and-acceptance.md` 当前记录四条业务 real-stack owner，但尚未记录 Workbench
如何复用它们。实施只在 13.x real-stack 验收区、`## 14. Deployment Smoke` 前新增 Workbench 小节；不改
`07` Phase 8 完成状态，后者由第四个 abstraction review/Exit Gate owner 更新。
