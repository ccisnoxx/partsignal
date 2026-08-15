# Frontend V2 Phase 6 verify blocker 修复设计

## 1. Decision

四组失败均修正测试边界，不修改 production。共同原则是让测试断言落在已有可访问语义 owner 上，而不是让跨区域同文案或 scoped CSS override 伪装成生产缺陷。

```text
global :root token owner ───────────────┐
                                       ├─ global.test.ts 分责验证
@media print .geo-insights-print-shell ┘

App Shell 主导航 ─┐
Product article ──┴─ Product test 只进入 article

Content Main Diff ──────┐
Content Reference Diff ─┴─ Content test 只进入“内容文档”region

当前核验失败提示 ──────┐
不可变核验历史 ────────┴─ Publication test 只进入“发布内容与操作”region
```

## 2. Failure ownership and minimum correction

| Group | Evidence | Root cause | Authoritative owner | Minimum correction | Behavior |
| --- | --- | --- | --- | --- | --- |
| Global tokens, 7 | `global.test.ts:38-41` 对整个 raw CSS 计数；`global.css:420-435` 在 `@media print .geo-insights-print-shell` 覆盖 7 个全局 token | 测试把 `:root` 权威声明与经批准的 Print 继承覆盖混为同一作用域 | `:root` 拥有全局值；Print shell selector 拥有纸张高对比局部值；测试拥有两者边界 | 在 test 内提取精确 Print shell block；从全局唯一性扫描排除该 block，并单独断言其 override 名称和值的完整 allowlist | 保持 |
| Product Detail, 1 | `product-detail-page.test.tsx:152-154` 搜索整棵 document；`navigation.ts:53-92` 已有五个导航组；`product-detail-page.tsx:135-280` 是具名 article | domain 测试把 App Shell 的 `h2` 纳入页面章节顺序 | Product article 与 App Shell navigation 分别拥有各自 heading | 使用 `within` 进入具名 Product article，只断言七个 DetailSection headings | 保持 |
| Content Editor, 1 | `content-editor-page.tsx:345-363` 定义 `内容文档`/`参考` panes；`:475` 与 `:543` 都渲染同一 `ContentDiffView` | 单元素 document 查询跨越 Main 与 Reference 两个真实消费者 | Workspace pane label 是可访问测试边界；Content domain 继续拥有服务端 Diff | 在 `内容文档` region 内断言 `v1 → v2` 与 `+当前正文` | 保持 |
| Publication Workspace, 1 | `publication-workspace-page.tsx:91-101` 生成核验历史；`:206-209,305-339` 显示当前核验状态；`:256-259` 保留历史 | 最新 comment 同时作为当前恢复提示和不可变历史证据，document 查询产生两个匹配 | `发布内容与操作` main pane 拥有当前恢复提示；`历史与附件` 拥有 Timeline | 在 `发布内容与操作` region 内等待并断言失败说明；保留现有 link/focus assertions | 保持 |

## 3. Global token contract design

### 3.1 Existing contract

- `frontend-v2/src/styles/global.css:58-118` 的 `:root` 持有全局 token。
- 已归档 `frontend-v2-geo-insights-print` 的 PRD、design 和 implement 明确要求 Print 使用纸张高对比表面、文字与 `print-color-adjust`，且 CSS 必须 route-scoped。
- `frontend-v2/src/styles/global.css:420-435` 满足该要求：override 位于 `@media print` 且 selector 精确为 `.geo-insights-print-shell`。

### 3.2 Test boundary

测试不引入 CSS parser 或 helper。使用当前 raw CSS 做两个直接断言：

1. 提取唯一的 `@media print > .geo-insights-print-shell` declaration body；移除该 body 后，`requiredTokens` 每项仍只能出现一次，从而任何其它 scoped duplicate 继续失败。
2. 将该 body 中的 custom property declarations 与批准的精确列表比较；多一个、少一个、改名、移出 selector 或改变高对比值都失败。

这比简单把期望计数改为 2 更严格，也不需要修改 production CSS。

## 4. Semantic query design

- Product 使用 `article` 的 accessible name `PS-001`，然后以 `within(article).getAllByRole('heading', { level: 2 })` 断言页面章节。主导航已有独立 `navigation` 断言，不复制导航组到 domain section contract。
- Content 使用 `region` accessible name `内容文档`。断言仍覆盖具体版本和具体 ADD line，不改为多元素计数。
- Publication 使用 `region` accessible name `发布内容与操作`。断言锁定当前恢复提示；不可变历史由该页面现有 Timeline 与 real-stack 证据继续覆盖，不删除 production 内容。
- 不使用数组下标、CSS class、DOM parent traversal、模糊 selector 或 `getAllByText`。

## 5. Exact writable files after approval

### Test corrections

- `frontend-v2/src/styles/global.test.ts`
- `frontend-v2/src/domains/product/product-detail-page.test.tsx`
- `frontend-v2/src/domains/content/content-editor-page.test.tsx`
- `frontend-v2/src/domains/publication/publication-workspace-page.test.tsx`

### Evidence and authoritative documentation

- `.trellis/tasks/08-15-frontend-v2-phase6-verify-blockers/research/audit.md`
- `.trellis/tasks/08-15-frontend-v2-phase6-verify-blockers/implement.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`

`prd.md`、`design.md` 与 `task.json` 只在规划或最终状态确需同步时更新。默认不修改任何 production TSX/CSS、frontend spec、ADR、contract 或 generated file。

## 6. Compatibility and contract impact

- DOM、视觉、打印、导航、Diff、核验历史、API 请求、状态、权限与缓存行为全部不变。
- 没有迁移、rollout flag、compatibility fallback 或第二实现。
- 若实施证据表明必须改变 production、公共合同或依赖，本设计失效并返回 planning，不自行扩展。

## 7. Documentation decision

- `07` 只追加本 blocker Task 的修复结果、最终门禁证据和 Exit Gate 判定，不改写已归档历史。
- `08` 记录四组测试边界、各层计数/耗时和完整 `make verify`/cleanup 证据。
- `04`、`09` 和 frontend specs 不更新：本 Task 没有新增稳定设计决策，只让测试服从已有合同。

## 8. Rollback

- 四个测试文件可按 group 独立回退；无 production 行为或数据回滚。
- 若完整门禁失败，文档保持或恢复为 `NOT_MET` 并记录 blocker；不得留下没有当前证据的 `MET`。
