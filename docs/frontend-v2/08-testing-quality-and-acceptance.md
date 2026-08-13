# PartSignal Frontend V2 测试、质量与验收规范

## 1. 目标

V2 不允许再次出现：开发环境正常但部署后表格崩坏、按钮只在特殊状态报错、路由可进但菜单/返回/筛选不对、操作列行为漂移、只在 1440 验证、前端隐藏动作但后端业务流程仍出错。

测试覆盖：Domain behavior、Design System contract、URL/navigation、production build、responsive、accessibility、server action contract。

## 2. 测试分层

```text
Unit
  ↓
Component
  ↓
Storybook interaction / visual
  ↓
Integration
  ↓
E2E
  ↓
Production build smoke
```

## 3. Unit

重点：search schema、action mapping、status mapping、filter normalization、formatter、view-model、error parser。

`resolve-actions.ts` 必须验证 server primary task 映射、unknown action fallback、danger confirmation，且不从 status 计算资格。

## 4. Component Tests

RowActions：一个 primary、overflow keyboard、disabled reason、destructive confirm。  
FilterBar：URL state、reset、page reset。  
Table：loading/empty/filtered empty/selection/pagination/long text。  
Workspace：sticky actions、disabled submit、revision conflict、dirty guard。

## 5. Storybook

Table Story：0/1/50 rows、loading、error、long title、only overflow、no action、narrow。  
Workspace Story：long Markdown、empty reference、many warnings、dirty、conflict、review readonly、mobile。

## 6. E2E 核心流程

### Auth

login → must change password → unauthorized admin route → logout。

### Product Facts

create product → enter facts → submit → review → approve → 验证 `CREATE_CONTENT_TASK` 与 Phase 3 handoff link。

### Fact Changes

submit → changes requested → revise → resubmit → approve。

### Content

create task → Task Detail → manual draft → edit/save → submit review → Content Review approve → canonical Task Detail → approved readonly Version Detail → `START_PUBLICATION`。

### Content Revision

review reject → canonical Task Detail/Editor → create HUMAN revision → update/save → resubmit → approve → 验证旧版本不变、新 current pointer 与目标版本审核时间线。

### Publication

approved content → start work → register result → verify success → PublishedArticle。连续真实栈验收必须从 Ready Queue 通过 V2 UI 开始发布，并验证成功核验后成果、来源内容 snapshot、verification 与 publication events 保持只读。

### Failed Verification

verify fail → ACTION_REQUIRED → Content revision/review/approval → switch version → re-register result → reverify PASSED；动作资格必须来自服务端 `primary_task / available_actions`。

### Post-Publication Issue

PublishedArticle → open issue → create repair task → 按服务端主任务进入 repair ContentTask → resolve issue；最终只读投影必须保留 Article issue history、Issue resolution 与修复任务来源关联。

Issue 页面级门禁还需分别证明：列表与 Workspace 首屏各只有一个 canonical GET；repair-context 只在动作打开后读取；OPEN/COMPLETED/CANCELLED repair 与 RESOLVED 的主任务只随服务端投影变化；409 保留输入且不 replay；Article 登记成功使用响应 ID 进入 Workspace。fixture 必须拒绝未声明 API，覆盖 375/768/1024/1280/1440 与页面根无横向溢出。

### GEO

new observation → detail → correction → original remains immutable。

Observation List 的 required evidence 分为两层：PostgreSQL integration 证明链尾选择、两类观测 compact projection、canonical/Product/platform/accuracy/date filter、稳定排序/分页、证据继承、固定批量查询与 actor-aware actions；generated-type production fixture 证明页面只调用 list-items 与明确 delete，不请求 Product、Query Topic、旧完整列表或 Detail。fixture 覆盖八列、canonical links、无“查看详情”、action gating、loading/empty/filtered-empty/error/retry、URL→API 一一映射、分页、键盘/Dialog 焦点返回，以及 375/768/1024/1440 页面根无横向溢出。

GEO Topics 的 required evidence 同样分为两层：PostgreSQL integration 证明完整列表兼容、服务端 search/sort/page、三类批量引用、所有角色可见摘要、ADMIN deletion、revision lock、审计和 mutation 最终守卫；generated-type strict fixture 只允许 auth/CSRF、Topic list-items、显式完整 reload 与 POST/PATCH/DELETE，并在 teardown 拒绝未声明 API。fixture 覆盖固定五列、compact variants、服务端 primary handoff、canonical 引用链接、URL direct/refresh/Back/Forward、loading/empty/filtered-empty/error/retry/pagination、409 保留输入且不 replay、Dialog 焦点返回，以及 375/768/1024/1440 页面根无横向溢出。New Observation 与两个引用目标列表只补精确 handoff/filter 证据，不扩成完整 GEO E2E。

Observation Detail required evidence 分为三层：PostgreSQL integration 证明任意 selected node 的 root→tail 顺序、直接 evidence/继承 ID、Legacy/Manual 完整投影、终态文章 snapshot、actor actions 与固定查询次数；API/model/component tests 冻结 generated union、identity/chain assertion、404/403/409/普通错误和 readonly branch；production-artifact strict fixture 只允许 auth、一个 Detail GET 与 token 允许的 DELETE，覆盖 List/direct/refresh/Back/Forward、完整 chain/evidence/articles、New POST ID handoff、Dialog focus 及 375/768/1024/1440 无根级溢出。未声明 API 必须返回 501 并在 teardown 失败。

Correction Workspace required evidence 分为三层：PostgreSQL integration 证明权限、历史 ID→当前尾、候选新增/退出、历史空 Topic、append-only POST、冻结字段、证据不可复用、冲突无半成品及原链不变；API/model/page tests 证明 generated context、表单边界、权威 `supersedes_id`、只提交新证据、pending 防重、两类 409 不 replay、显式刷新按文章 ID 合并及 canonical replace；production-artifact strict fixture 只允许 auth、correction context、通用 POST、三阶段上传和精确 Detail GET，覆盖 Detail 入口/direct/refresh、404/403/Legacy、权限变化、上传 complete 重试、DirtyGuard、焦点及 375/768/1024/1440 无根级溢出。

Observation List、New Observation、Detail、Correction Workspace 与 Topics 已形成页面级接口闭环，但这些 fixture 不冒充 GEO real-stack。完整 `new observation → detail → correction` 真实闭环仍须在后续独立 Task 中进入现有唯一隔离编排。

### GEO Optimization

insight anomaly → server revalidate → create optimization task。

## 7. Router E2E

每个核心列表都验证：direct URL、filter URL、refresh、Back、Forward、open new tab、invalid search param fallback、breadcrumb、sidebar active state。

## 8. Responsive Matrix

| Width | 意义 |
|---:|---|
| 375 | Mobile |
| 768 | Tablet / narrow |
| 1024 | Small desktop |
| 1440 | Primary desktop |

核心 Workspace 额外考虑 1280 / 1920。

## 9. Table Acceptance

- [ ] primary column 清晰
- [ ] 行高一致
- [ ] header/fixed 行为稳定
- [ ] horizontal overflow 可控
- [ ] action 标准
- [ ] sort/filter state 恢复
- [ ] page reset 正确
- [ ] empty / filtered empty 分开
- [ ] long text 不破版
- [ ] row navigation keyboard accessible

## 10. Action Acceptance

- [ ] Primary 来源 server `primary_task`
- [ ] 最多 1 个 row primary
- [ ] Secondary 在 overflow
- [ ] destructive confirmation
- [ ] disabled reason 可解释
- [ ] mutation server revalidation
- [ ] conflict 清楚处理
- [ ] success 后 canonical state 更新

## 11. Workspace Acceptance

- [ ] 主要 artifact 面积最大
- [ ] context/reference 可访问
- [ ] 1024 不崩
- [ ] mobile 可通过 tabs/sheet 工作
- [ ] sticky action 不盖正文
- [ ] dirty guard
- [ ] loading 不抹掉整个 shell
- [ ] server error 可恢复
- [ ] immutable snapshot 不可编辑

## 12. Accessibility

人工与自动结合：keyboard-only、focus order/visible、dialogs/menus、form labels/errors、status color redundancy、reduced motion、contrast。可引入 axe，但自动检查不替代人工键盘验收。

## 13. Production Build

每个 PR/merge：lint、typecheck、unit、component、build。主分支/staging：E2E + production smoke。

生产构建必须对真实 build artifact 跑 smoke，而不只跑 Vite dev server。

### 13.1 Foundation Production Artifact Smoke

Phase 1 Foundation 使用 `frontend-v2/playwright.config.ts`，由 Playwright `webServer` 先执行 production build，再通过 `vite preview` 服务当前 `dist`。同一 smoke 分别在 375×900 和 1440×1000 验证：

- `/` direct URL 与 refresh；
- App Shell、desktop Sidebar、mobile navigation 与业务导航入口；
- 未捕获异常、`console.error`、失败请求和失败静态资源均为失败。

Foundation 尚未接管真实业务后端。测试只能通过显式命名的 Playwright fixture 隔离认证启动请求；fixture 不得进入运行时代码，任何未声明 API 请求必须失败。

自 Products List 起，`/products` direct URL、refresh、Back/Forward、search normalization、业务数据和行级动作由 `tests/e2e/products-list.spec.ts` 与 generated-type `products.fixture.ts` 接管。该 fixture 仅验证前端 production-artifact 页面/路由，不代表完整后端业务 E2E；Phase 2.8 再验证 Product Facts 真实闭环。

Phase 2.3 的 `/products/new` 由 `tests/e2e/new-product.spec.ts` 复用同一 fixture，fixture 的 POST 分支使用 generated `ProductCreate`/`Product` 约束并显式拒绝未声明 API。测试覆盖列表入口、direct URL/refresh、breadcrumb/sidebar、客户端与服务端字段错误、duplicate/forbidden、CSRF/body、pending 防重复、DirtyGuard Cancel/Back、canonical success navigation、列表后续重新获取、375/1440、键盘焦点，以及 console/pageerror/requestfailed 审计；它仍是 production-artifact 前端页面测试，不冒充真实后端 E2E。

Phase 2.4 的 `/products/$productId` 由 `tests/e2e/product-detail.spec.ts` 复用并扩展同一 fixture。fixture 使用 generated `ProductDetail`/`ProductUpdate`，只返回已经定义的 read-model fixture，所有未声明 API 请求显式失败；测试必须证明页面只请求一个 detail endpoint，不在浏览器跨域 join。覆盖 List/New → Detail、direct/refresh/Back/Forward、breadcrumb/sidebar、事实与跨域摘要有/无数据、服务端 Activity 顺序、primary/overflow token、UPDATE canonical refresh、DELETE blocker/revision、404/403/retry、375/768/1024/1440、keyboard/focus，以及 console/pageerror/requestfailed 审计。它仍是 production-artifact 前端页面测试，不冒充完整真实业务 E2E。

Phase 2.5 的 `/products/$productId/facts` 由 `tests/e2e/fact-workspace.spec.ts` 继续复用 generated-type `products.fixture.ts`。fixture 使用 `ProductFactsDraft`、`ProductFactsDraftUpdate`、`FactReviewSubmissionRequest` 与 `FactVersion`，并拒绝任何未声明 API；测试证明页面只用一个 facts read model，不请求 Product Detail 或自行 join。覆盖 direct/refresh、空 Markdown、loading、404/403/retry、服务端 action token、save canonical response、`expected_revision`/CSRF、Ctrl/Cmd+S、revision conflict 本地保留与显式 reload、提交后停留原路由并刷新 actions、DirtyGuard、键盘焦点、375/768/1024/1440 无横向溢出，以及 console/pageerror/requestfailed 审计。真实 PostgreSQL snapshot 不可变性由 backend integration test 证明；该前端 fixture 不冒充完整业务闭环，也不进入 Fact Review。

Phase 2.6 的 `/products/$productId/facts/review` 由 `tests/e2e/fact-review.spec.ts` 复用 generated-type `products.fixture.ts`。fixture 只允许一个产品级 review context GET 和精确版本 approve/request-changes 命令，拒绝 Product Detail、Facts、Versions 或 exact-context join。覆盖 direct/refresh、empty、404/403/retry、不可变 sanitized Markdown、metadata、服务端 Diff、目标版本专属 Review History、action token、CSRF/`expected_revision`、canonical response 后 context 刷新、空白退回意见、409 不重放、Dialog 键盘与焦点恢复、375/768/1024/1440 无横向溢出，以及 console/pageerror/requestfailed 审计。

Phase 2.7 的 `/products/$productId/facts/versions/$versionId` 由 `tests/e2e/fact-version-detail.spec.ts` 继续复用 generated-type `products.fixture.ts`。fixture 只允许精确 FactVersion GET，拒绝 Product Detail、Facts、Review Context 或 Versions list join；从 Product Detail 进入时仅额外允许既有 detail 请求。覆盖 Product Detail 链接、direct/refresh、不可变 sanitized Markdown、version/status/classification/change summary/revision/创建与可选审批 metadata、approved/pending/changes-requested、URL productId 与响应 product_id 不一致时阻断内容、loading、404/403/retry、返回 Fact History、375/768/1024/1440 无横向溢出、keyboard/focus，以及 console/pageerror/requestfailed 审计。本页不验证命令。

Fact History 的 `/products/$productId/facts/versions?page=1&pageSize=20` 由 `tests/e2e/fact-history.spec.ts` 复用同一 generated-type fixture。fixture 只允许分页 `ProductFactHistoryList` GET 和被点击的精确 FactVersion GET，所有未声明 API 继续失败；测试覆盖 `VIEW_FACT_HISTORY` canonical route、direct/refresh/Back/Forward、服务端顺序、六列且无操作列、readonly detail link、URL product boundary、loading/empty/404/403/retry、无业务命令、四档响应式、keyboard/focus 与浏览器运行时错误审计。

Phase 3.1 的 `/content/tasks?archiveStatus=ACTIVE&page=1&pageSize=20` 由 `tests/e2e/content-task-list.spec.ts` 和 generated-type `content.fixture.ts` 接管。fixture 只允许认证、ContentTaskList、平台筛选参考、永久删除 preview 与本页生命周期命令，其他 API 必须失败；测试覆盖 direct/refresh/Back/Forward、服务端搜索/阶段/平台/归档筛选与分页、固定六列、服务端 stage/primary/overflow、loading/empty/filtered-empty/error/retry、CSRF/comment/revision、永久删除实时范围、409 不重放、375/768/1024/1440、键盘/Dialog 焦点返回及 console/pageerror/requestfailed 审计。该 fixture 只验证 production artifact；Phase 3 的完整 Content 真实闭环保留到 E2E 检查点。

Phase 3.2 的 `/content/tasks/new` 继续扩展同一 generated-type `content.fixture.ts`，只新增 creation-options、Product Detail handoff 和 ContentTask create 的明确分支，所有未声明 API 继续失败。`tests/e2e/new-content-task.spec.ts` 覆盖三字段合同、URL handoff 与 Back/Forward、dependent selection、options 状态、稳定 Idempotency-Key、pending 防重、结构化错误、DirtyGuard、成功采用 canonical ID 进入 Detail 和四档响应式；不进入 Editor、Generation、Manual Draft 或 Review。

Phase 3.3 的 `/content/tasks/$taskId` 继续使用同一 generated-type fixture，但页面只允许一个精确 Detail GET 与明确 lifecycle command；Task List、FactVersion、ContentVersion、GenerationJob、Review、Publication 或 GEO join 均作为未声明请求失败。`tests/e2e/content-task-detail.spec.ts` 覆盖 List/New 入口、direct/refresh/Back/Forward、完整与空 compact sections、服务端 primary、409 canonical refetch、404/403/retry、archived verified readonly、375/768/1024/1440、键盘/Dialog focus return 和浏览器错误审计。

Phase 3.4 的 `/content/tasks/$taskId/editor` 继续扩展 generated-type `content.fixture.ts`。首屏只允许一个精确 Editor Context GET；manual/revision/save/submit/delete/abandon 与 generation/retry/humanization 只开放对应 token 的既有 command，未声明 API 继续失败。`tests/e2e/content-editor.spec.ts` 除 Core 的人工首稿、保存、修订、提交、readonly matrix、CSRF/revision、DirtyGuard、Preview/Diff 与响应式矩阵外，还覆盖 generation-options 按需加载、Prompt/model 明确确认、稳定幂等键、active-only polling、terminal refetch、progress/success/failure、按需 detail、原 job retry 和新版本 humanization；仍不覆盖审核决定。

`/content/tasks/$taskId/review` 由 `tests/e2e/content-review.spec.ts` 和同一 generated-type Content fixture 覆盖。页面只允许一个 task-scoped Review Context GET 和对当前主线的 approve/request-changes command；测试覆盖 direct/refresh/Back/Forward、只读 canonical Markdown/Fact/diff/snapshot/history、token 动作、空意见、CSRF/revision、409 不重放与 request ID、375/768/1024/1440、键盘/Dialog focus return 及浏览器错误审计。fixture 不冒充完整闭环；连续业务证据由下述 Content real-stack flow 负责。

`/content/versions/$versionId` 由 `tests/e2e/content-version-detail.spec.ts` 和 generated-type Content fixture 覆盖。fixture 只允许一个精确 `ContentVersionDetail` GET，Editor/Review Context、GenerationJob、版本历史和所有 mutation 都必须失败；测试覆盖 Task Detail 入口、direct/refresh/Back/Forward、canonical Task/Fact link、HUMAN/AI、六种 ContentVersion status、当前/历史版本始终只读、snapshot 有无、Markdown sanitize/长正文/tags/change summary、legacy nullable updated time、loading/404/403/error/retry、375/768/1024/1440、键盘及 console/pageerror/requestfailed 审计。`tests/e2e/content-version-detail-real-stack.spec.ts` 在隔离 production preview 中创建真实 HUMAN 版本并完成独立只读 GET；响应固定查询次数和 snapshot 一致性由 backend integration test 证明。

### 13.2 Product Facts 真实栈闭环

Phase 2.8 的 `tests/e2e/product-facts-real-stack.spec.ts` 由 `deploy/scripts/e2e-local.sh` 在现有隔离生命周期内显式开启。脚本创建进程唯一 PostgreSQL、执行 migration/seed、启动真实 FastAPI，并以 `VITE_API_BASE_URL` 构建 V2 后运行 4174 `vite preview`；不得使用 Vite dev server、共享开发数据库或第二套 orchestration。

测试不得导入 `products.fixture.ts`，也不得用 `page.route`、`route.fulfill` 或页面本地状态模拟 Product Facts API。测试 API 只允许登录、创建流程所需且 V2 尚无管理页的唯一活动平台前置配置，以及读取最终投影；Product create、facts save、submit review、request changes、revise、resubmit、approve 与 ContentTask create 必须操作 V2 页面。每条 flow 使用唯一数据，清理由脚本统一 drop 测试数据库，不增加逐记录删除器。

- Flow A：create → enter/save facts → submit → review/approve → Product Detail handoff → `/content/tasks/new?productId=...` → 选择真实 approved FactVersion 与 active Platform → 创建 ContentTask → 进入真实 `/content/tasks/$taskId`，由单一 read model 验证 Product、approved FactVersion、Platform 与 `CREATE_FIRST_DRAFT`；不创建 AI job 或人工首稿、不进入 Editor。随后继续验证 immutable Fact Version Detail。
- Flow B：create → submit → request changes → revise/save → resubmit → approve，并通过页面断言目标从 `FactVersion v1` 前进到 `v2`，最终 review history 的每条 `target_id` 都只属于新版本；随后从 Product Detail 打开真实 Fact History，断言服务端顺序为 v2、v1，并从列表进入 v2 readonly Detail。
- Flow C：使用独立 ContentTask 从 Task Detail 进入 Editor，完成 manual first draft → save → submit review；每步重新读取 Editor Context，验证 canonical version/revision/action 与 `current_content_version_id` 主线，不创建 GenerationJob，也不复用 Flow A/B 的互斥状态数据。

默认 `npm --prefix frontend-v2 run e2e` 继续运行 fixture-based 页面矩阵，真实栈 spec 在没有显式开关时 skip；完整根 E2E 先在隔离栈运行 V1 与 V2 真实闭环，再运行 V2 fixture suite。真实闭环不重复 loading、404、四档响应式和键盘矩阵。

### 13.3 Content AI Production 真实栈闭环

`tests/e2e/content-ai-real-stack.spec.ts` 复用 `deploy/scripts/e2e-local.sh` 的同一隔离数据库、Redis、FastAPI、Celery Worker、fake AI provider 与 V2 production preview，并在 V1 suite 之前运行。测试不得导入 fixture 或拦截 API；V2 尚未迁移的 Prompt/AI 渠道前置配置可使用 API，Product、Fact、ContentTask、generation、retry 与 humanization 业务 mutation 必须操作 V2 页面。

独立 AI flow 覆盖：V2 创建并批准虚构事实与 ContentTask；按需确认 Prompt revision/model 后生成 AI DRAFT；以 `current_content_version_id` 验证 canonical current；通过 `CREATE_HUMANIZATION_JOB` 创建新 Job/ContentVersion 并验证源版本字段不变；使用唯一 timeout model 得到真实 `AI_PROVIDER_TIMEOUT`，按需打开完整 `content-markdown-v3` snapshot；更新测试凭据后从 V2 对原 job 执行 retry，并断言新 job 的 `retry_of_id` 和 `input_snapshot` 与失败 job 精确一致。固定成功 fallback、浏览器 snapshot 拼装和共享开发服务均禁止。

### 13.4 Content 完整真实栈闭环

`tests/e2e/content-review-real-stack.spec.ts` 复用同一隔离 PostgreSQL、独占 Redis、FastAPI、Celery、fake AI provider 和 V2 production preview，不导入 `content.fixture.ts`、不拦截 API，也不新增 orchestration。两条 flow 各自创建唯一 Platform/Product/Fact/ContentTask/version chain；只有尚未迁移的 Platform 前置数据使用 API mutation，Product、Fact、Task、draft、save、submit、decision、revision 与 approve 全部通过 V2 页面完成。

- Flow A：manual draft → edit/save → submit → approve → canonical Task Detail；页面与最终只读投影同时证明 `workflow_stage=APPROVED`、`current_content_version_id` 指向已批准版本、readonly Version Detail 审核结果为 `approve`，且服务端已投影 `START_PUBLICATION` 与 `/publishing/work` handoff。
- Flow B：独立 v1 submit → request changes → canonical Editor 创建 HUMAN v2 → update/save → resubmit → approve；最终证明 v1 payload 不变、v2 `based_on_id` 指向 v1 并成为 current approved version，v1 的 submit/request-changes 与 v2 的 submit/approve 记录都只关联正确 `target_id/target_version`。

既有 `content-ai-real-stack.spec.ts` 继续独立证明 generation、failure、exact retry 和 humanization，完整 Content flow 不重复 AI 步骤；fixture 继续专注 loading、404、四档响应式和键盘矩阵。

### 13.5 Published Articles 只读成果验收

`tests/e2e/published-articles.spec.ts` 扩展同一 generated-type Publication fixture，只允许 Article list/detail GET；未声明 API 继续返回 501 并使 teardown 失败。测试覆盖 canonical `q/page/pageSize/sort`、direct/refresh/Back/Forward、服务端分页与 filtered empty、固定五列无操作列、List → Detail 键盘导航、404/403/409/request ID、Markdown sanitize、来源/核验/lineage/timeline、375/768/1024/1440 和无 mutation 控件。

`tests/e2e/publication-workspace-real-stack.spec.ts` 在既有隔离 PostgreSQL/FastAPI/V2 production preview 生命周期中增加独立 PublishedArticle 读取用例：API 只建立唯一完成聚合，浏览器随后只发送 Article list/detail GET，验证 Article/Work 同 ID、来源 ContentVersion ID/hash、PASSED snapshot、事件时间线和 readonly 边界。不新增第二套 orchestration，也不重复完整 ACTION_REQUIRED flow。

### 13.6 Publishing 完整真实栈闭环

`tests/e2e/publication-workspace-real-stack.spec.ts` 继续复用 `deploy/scripts/e2e-local.sh` 的单一隔离 PostgreSQL、独占 Redis、FastAPI、对象存储和 V2 production preview 生命周期；不新增 fixture、spec 或 orchestration。测试 API 只用于唯一前置数据和最终只读投影，新增连续业务命令均由 V2 UI 完成。

- Flow A：Ready Queue → start work → preparation/account switch → platform review/screenshot → register result → PASSED → immutable PublishedArticle → open `CONTENT_CHANGED` issue → create repair ContentTask → Issues List 依据服务端 `primary_task` 进入修复任务 → resolve `RESTORED`。最终只读断言锁定 Work/Article 同 ID、批准 ContentVersion ID/hash/Markdown/Fact snapshot、PASSED verification snapshot、完整 publication events、Article issue history、Issue resolution history，以及 repair task 的来源 Issue、`NO_DRAFT / CREATE_FIRST_DRAFT` 和空 current pointer。
- Flow B：保留既有 FAILED → ACTION_REQUIRED → Content HUMAN revision/save/review/approve → switch version → re-register result → PASSED，证明旧发布结果与失败核验 snapshot 不变、新批准版本成为完成成果来源。

完整门禁通过 V2 real-stack `10 passed` 与指定 V1 Trusted Types `7 passed`；退出码为 0，并由脚本报告隔离数据库、对象存储目录 `status=deleted`。该验收不进入 Publishing 抽象回顾、GEO，也不要求生产代码、OpenAPI、数据库或依赖变更。

`frontend-v2-fact-history` 已通过 contract-check、PostgreSQL integration、V1 既有调用测试、V2 component、fixture Playwright 与上述真实栈 Flow B。Fact History gap 已关闭，Phase 2 exit gate 从 `NOT_MET` 改判为 `MET`。

### 13.7 GEO Observation List 页面验收

`tests/e2e/geo-observations.spec.ts` 使用独立 generated-type `geo.fixture.ts`。fixture 只允许认证、`GET /api/v1/geo-observations/list-items` 和有资格行的 DELETE；其他 API 返回 501，并在 teardown 将请求与浏览器运行时错误作为失败。组件与 fixture 同时覆盖 URL canonicalization、server query mapping、八列/长文本/compact indicators、actions、状态、retry、分页、CSRF、单次删除、Dialog cancel focus return 和四档响应式；它只证明 V2 production artifact，不代表 GEO 完整业务闭环。

### 13.8 New GEO Observation 页面验收

`tests/e2e/new-geo-observation.spec.ts` 在 `geo.fixture.ts` 上叠加 generated-type `new-geo.fixture.ts`，只开放 Product、Query Topic、GEO Published Article candidates、创建命令、三阶段文件上传和创建 ID 对应的精确 Detail GET；未声明 API 在 teardown 失败。API/model/component tests 覆盖权威 query、结构化 read/create error、显式事实、payload 字段边界、SHA-256、PUT/POST transfer 与 complete retry；production-artifact E2E 覆盖 List 入口、direct/refresh、candidate loading/empty、客户端 required validation、附件、CSRF、无 Idempotency-Key 的 pending 单 POST、`GEO_PUBLICATIONS_CHANGED` 显式刷新且不 replay、POST ID canonical Detail handoff 且不搜索 List、DirtyGuard、Back/Forward、键盘焦点和 375/768/1024/1440 页面根无横向溢出。fixture 不代表 GEO 完整 real-stack 闭环。

### 13.9 GEO Observation Correction Workspace 页面验收

`tests/e2e/geo-observation-correction.spec.ts` 使用独立 generated-type `geo-correction.fixture.ts`，只开放认证、Manual Detail 入口、correction-context、通用 Observation POST、三阶段文件上传和创建 ID 对应的精确 Detail GET；未声明 API 在 teardown 失败。后端 integration 与 contract tests 覆盖 append-only、服务端资格/尾/候选/冻结字段/证据边界；API/model/page tests 覆盖严格上下文、初值、payload、错误映射、pending 防重、缓存失效、DirtyGuard 和冲突合并。production-artifact E2E 覆盖历史 ID canonical replace、完整只读历史、上传 complete 失败/重试、CSRF、无 Idempotency-Key、两类 409 不 replay、显式刷新保留草稿/证据并采用新尾、404/403/Legacy/提交时权限变化、响应 ID handoff、键盘与 375/768/1024/1440 页面根无横向溢出。fixture 不代表 GEO 完整 real-stack 闭环。

## 14. Deployment Smoke

部署后至少验证：`/login`、`/`、`/products`、`/content/tasks`、`/publishing/work`、`/geo/observations`、管理员 `/settings/*`、`/system/audit`。

检查 JS chunks、API base URL、client routing fallback、direct deep link、asset caching、CSP/source map 策略。

## 15. Visual Regression

优先抓 Pattern，而不是机械截全站：Table default/action、Workspace 3-pane、Review、Dialog、Sheet、mobile list、Analytics KPI。

## 16. Error Contract Tests

覆盖 revision conflict、forbidden、action no longer available、referenced object cannot delete、validation、AI unavailable、publication verification failure、stale data。前端对应 error code 必须有明确 UX。

## 17. Performance

关注 initial JS、route lazy loading、table render、large Markdown、analytics chart、query fan-out。Server pagination 优先；不要为 20 行表过早虚拟化；真正大量数据才用 TanStack Virtual；避免 waterfall。

## 18. Observability

前端错误建议记录 route、user-visible action、error code、request id、app version、build sha。严禁记录 API key、密码、secret headers 或其他敏感 credential。

## 19. Definition of Done

一个页面只有同时满足 Product + Architecture + Contract + Test + Responsive + Accessibility + Production Build，才算 V2 可迁移页面。
## 20. GEO Insights 验收边界

`tests/e2e/geo-insights.spec.ts` 使用 generated-type strict fixture 验证 canonical 七参数映射、direct/refresh/Back/Forward/reset、loading/error/retry/empty/partial/unavailable、三项趋势精确表格、服务端 drill-down、Recommendation 无伪链接、按需 creation-options、优化 POST header/body、409 不自动重放、响应 ID 导航和四档根无溢出。fixture 未声明 API、page error 与非预期 console error 均失败。

同一 fixture 的 Print read-only gate 只允许 auth 与一个 Insights GET，并复用同一 success/empty payload；测试断言七参数 API 映射、筛选人类标签、全部只读 sections、三个直接可见精确表、无操作/Dialog/普通导航/options/mutation，以及 `window.print()` 调用。Playwright 两个 project 分别量测 375/768 与 1024/1440 根无溢出，并用 Print media 验证控件隐藏、重复表头和 row/短卡片分页规则；不生成 PDF。该证据仍不替代完整 GEO real-stack E2E。

后端 required gate 另覆盖 OpenAPI、历史平台 UUID migration、repeatable-read read model、actor-aware action、Coverage 最终复算和同 key 并发唯一。该 strict fixture 不替代明确排除的完整 GEO real-stack E2E。
