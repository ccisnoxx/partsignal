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

approved content → start work → register result → verify success → PublishedArticle。

### Failed Verification

verify fail → ACTION_REQUIRED → update/switch version → reverify。

### Post-Publication Issue

open issue → create repair task → resolve issue。

### GEO

new observation → detail → correction → original remains immutable。

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

`frontend-v2-fact-history` 已通过 contract-check、PostgreSQL integration、V1 既有调用测试、V2 component、fixture Playwright 与上述真实栈 Flow B。Fact History gap 已关闭，Phase 2 exit gate 从 `NOT_MET` 改判为 `MET`。

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
