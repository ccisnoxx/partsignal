# E2E `available_actions` 合同同步

## 1. 目标

把 compatibility、Trusted Types 的本地 API mock 和 MVP 自然化流程期待同步到已经批准并实施的 required `available_actions` 合同，消除集中回归中七项旧测试资产误报，同时继续证明前端只消费服务端动作投影、服务端命令仍执行最终守卫。

## 2. 背景与根因

- `2e59943` 已完成全局资源动作投影收敛；`.trellis/spec/backend/available-actions-contract.md` 明确规定每个资源响应的 typed `available_actions` 为 required，认证自服务 `UserOut` 必须显式返回空数组，客户端不得为缺字段增加默认值。
- 集中回归报告 `.trellis/tasks/archive/2026-08/08-01-round-2-seven-group-centralized-regression/report.md` 记录完整 E2E 为 `44 passed, 8 failed`。其中六项跨浏览器失败来自旧 mock 缺少必填字段，一项 MVP 失败来自旧自然化期待；剩余一项 Dashboard 视觉基线不属于本任务。
- `frontend/tests/e2e/compatibility.spec.ts:4-42` 的认证用户和产品列表 mock 缺少 `available_actions`。
- `frontend/tests/e2e/trusted-types.spec.ts:36-73` 的认证用户、产品详情和事实工作区，以及 `:119-126` 的改密入口认证用户 mock 缺少 `available_actions`。
- `frontend/tests/e2e/mvp-flow.spec.ts:501-506` 在全局自然化 Prompt 未配置时仍期待“自然化”按钮可用；当前服务端只在 Prompt 已配置时投影 `CREATE_HUMANIZATION_JOB`，但命令直调仍应返回既有 `409/HUMANIZATION_PROMPT_MISSING`。
- 同一 MVP 用例把真实自然化预览的旧标题当作新作业完成信号，并把包含动态 `available_actions` 的内容版本响应做整体静态相等比较；继续运行后还发现“无匹配账号”路由夹具只清空 `matching_accounts`，没有同步清空 `REGISTER`。
- 当前产品合同、服务投影和前端消费者已经与批准决策一致；根因是 E2E 测试资产没有随 required 字段和动作资格更新，不是产品兼容缺口。

## 3. 需求

### R1. compatibility mock 合法化

- `/api/v1/auth/me` 的认证自服务用户显式返回 `available_actions: []`。
- `/api/v1/products` 的产品项显式返回 `available_actions: ['UPDATE']`；`DELETE` 依赖数据库引用事实，不在隔离 mock 中猜测。
- 保持现有登录装饰、长标签、横向滚动、焦点回收和打印断言不变。

### R2. Trusted Types mock 合法化

- 两处已认证 `/api/v1/auth/me` mock 均显式返回 `available_actions: []`。
- `/api/v1/products/:id` 显式返回 `available_actions: ['UPDATE']`。
- 非空 `/api/v1/products/:id/facts` 工作区按权威投影返回 `available_actions: ['SAVE', 'CREATE_VERSION']`。
- 保持生产 CSP、Trusted Types violation、Markdown 清洗、主题切换、匿名登录和改密 smoke 的断言不变。

### R3. MVP 自然化期待同步

- 全局自然化 Prompt 不存在时，同一内容版本行的“自然化”按钮必须禁用，因为响应不包含 `CREATE_HUMANIZATION_JOB`。
- 保留同一分支的直接 POST，并继续断言 `409` 与 `HUMANIZATION_PROMPT_MISSING`，证明服务端最终守卫没有被前端投影替代。
- 保存全局自然化 Prompt 后，重新获取的内容版本必须投影 `CREATE_HUMANIZATION_JOB`，“自然化”按钮恢复可用，后续作业创建和追溯链保持通过。
- Prompt 页的自然化预览是真实作业，必须等待本次新作业成功后再验证动作恢复；源内容字段保持不变，但动态动作数组按当前资格单独断言。

### R4. 发布候选动作 mock 同步

- 当测试路由把目标候选的 `matching_accounts` 改为空数组时，同步把其 `available_actions` 改为空数组。
- 保留“无匹配账号”、业务设置链接和“准备人工发布”禁用断言，证明 UI 只消费服务端动作而不从账号数组自行推导。

### R5. 测试资产边界

- 只修改三个现有 E2E 文件及本任务资料，不新增 fixture fallback、共享默认动作、第二套 Schema、测试框架或运行时依赖。
- 不修改产品 Schema、OpenAPI、生成类型、前端消费者、后端投影器或命令守卫来兼容旧 mock。
- 保持现有 `.playwright-cli/` 与 `frontend/.playwright-cli/` 诊断产物未跟踪并排除，不自动推送。

## 4. 范围内

- `frontend/tests/e2e/compatibility.spec.ts`
- `frontend/tests/e2e/trusted-types.spec.ts`
- `frontend/tests/e2e/mvp-flow.spec.ts`
- 当前 Trellis 任务资料

## 5. 范围外

- Dashboard 当前外观审批与 `dashboard-light-1440x1000.png` 基线更新。
- Ant Design `Alert.message` → `title` 兼容清理。
- 发布 Drawer 焦点修复；该任务已由提交 `45966c1` 完成并归档。
- 产品代码、API/数据库合同、迁移、部署脚本、E2E 基础设施和共享开发数据。
- 本轮直接把第二轮总回归报告改判为通过；最终闭环需等待 Dashboard 基线任务完成后重跑完整 `make e2e`。

## 6. 验收标准

- [x] AC1：compatibility 在 Chromium、Firefox、WebKit 的目标项目中完成产品页渲染及原有兼容/焦点断言，不再因 Product 缺少 `available_actions` 产生运行时错误。
- [x] AC2：Trusted Types 在 Chromium、Firefox、WebKit 中完成 `TT-001` 安全预览、清洗和主题链，`runtimeErrors` 与 CSP violation 均为空。
- [x] AC3：自然化 Prompt 未配置时，“自然化”按钮禁用；直接命令仍精确返回 `409/HUMANIZATION_PROMPT_MISSING`。
- [x] AC4：保存自然化 Prompt 后按钮启用，既有自然化作业、快照与内容追溯链继续通过。
- [x] AC4A：自然化预览等待本次真实作业成功，源内容不变且动态动作重新包含 `CREATE_HUMANIZATION_JOB`。
- [x] AC4B：无匹配账号的发布候选 mock 同步返回空动作，设置链接可达且登记按钮禁用。
- [ ] AC5：定向隔离 E2E、`make contract-check`、前端 typecheck、lint 和 `git diff --check` 通过，隔离数据库与临时对象存储由脚本成功清理。
- [x] AC6：差异中没有产品 fallback、合同改动、生成类型手改、共享 fixture 抽象、Dashboard 基线、Alert 清理或无关重构。
- [x] AC7：现有 Playwright 诊断产物保持未跟踪且未纳入提交，不创建分支、不自动推送。

## 7. 权威实现位置

- 稳定合同：`.trellis/spec/backend/available-actions-contract.md`。
- 用户动作边界：`backend/app/services/identity.py::_user_actions`；认证自服务的权威结果为 `[]`。
- 产品与事实工作区投影：`backend/app/services/product_facts.py::products_out`、`product_facts_draft_out`。
- 自然化动作投影：`backend/app/services/projections.py::content_versions_out`。
- 前端消费：`frontend/src/features/content-tasks/ContentTasksPage.tsx`。
- 失败证据：集中回归 `report.md` 与 `research/regression-matrix.md`。

## 8. 依赖与决策

- `PS-QA2-DEC-002` 已批准并实施，本任务不得重新讨论或放宽 required 合同。
- 发布 Drawer 焦点后续缺陷已经完成，不再阻塞本任务。
- 本任务与 Dashboard 基线、Alert 兼容清理在代码上独立；推荐先完成本任务，再审批并同步 Dashboard 基线，最后统一重跑完整 E2E。
- 没有剩余产品、架构、兼容或范围决策；当前阶段仍只完成可审阅规划，未经最新规划批准不得运行 `task.py start`。
