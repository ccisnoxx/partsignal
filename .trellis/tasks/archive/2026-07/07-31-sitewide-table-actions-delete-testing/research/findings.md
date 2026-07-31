# 缺陷、测试阻断与产品决策项

## 1. 当前产品缺陷

### PS-QA-201：表格操作菜单的危险确认取消后焦点丢失

- 类型：可访问性 / UI 交互
- 严重程度：P2
- 状态：确认
- 已复现范围：产品列表、AI Header 列表、AI 模型列表。
- 最短步骤：
  1. 从表格行“更多操作”打开菜单。
  2. 选择删除并等待确认框打开。
  3. 点击“取消”，等待确认框关闭。
- 期望：焦点回到发起操作的“更多操作”按钮，键盘用户可继续当前位置。
- 实际：确认框关闭后 `document.activeElement` 为 `BODY`。
- 影响：键盘和辅助技术用户失去当前位置，需要从页面头部重新导航。
- 证据：真实 Playwright 会话 `full-admin-02`；产品、AI Header、AI 模型三处均复现；危险确认调用见 `frontend/src/features/product-facts/ProductsPage.tsx:63`、`frontend/src/features/configuration/AIChannelDetailPage.tsx:428,450`。
- 共享风险：项目内还有多处 `modal.confirm`；本轮只把真实复现的三处判为缺陷，其他调用点需在修复任务回归。

### PS-QA-202：危险删除确认向用户暴露“物理删除”实现术语

- 类型：UI 文案 / 一致性
- 严重程度：P2
- 状态：确认
- 期望：菜单、按钮和确认标题使用用户能理解的业务语言，删除范围与不可恢复后果写在正文。
- 实际：产品、事实版本、平台、发布账号的确认标题和 GEO 删除正文直接使用“物理删除”。
- 影响：用户需要理解存储实现，且同一删除动作在不同页面使用不同语言。
- 证据：
  - 规范：`.trellis/spec/frontend/component-guidelines.md:108`
  - `frontend/src/features/product-facts/ProductsPage.tsx:63`
  - `frontend/src/features/product-facts/ProductFactsPage.tsx:158`
  - `frontend/src/features/configuration/PlatformsPage.tsx:255`
  - `frontend/src/features/settings/SettingsPage.tsx:169`
  - `frontend/src/features/geo-observations/GeoObservationsPage.tsx:303`
- 浏览器证据：产品删除确认显示“物理删除产品……？”。

### PS-QA-203：AI Header 删除确认未说明测试结论失效

- 类型：业务逻辑可见性 / UI 文案
- 严重程度：P2
- 状态：确认
- 最短步骤：
  1. 创建并测试 AI 渠道和模型。
  2. 在 Header 行选择删除。
- 期望：确认框说明删除 Header 会撤销渠道与模型的旧测试结论。
- 实际：确认框只有标题与确认/取消按钮，没有影响说明。
- 影响：管理员可能把删除理解为只移除一行 Header，无法预判渠道与模型需要重新测试。
- 服务端权威：`backend/app/services/ai_configuration.py:511-524` 删除后调用 `invalidate_channel_models`。
- 前端证据：`frontend/src/features/configuration/AIChannelDetailPage.tsx:428`；同页模型删除在 `:450` 已有影响说明，可作为一致性参照。

## 2. 当前测试缺陷

### PS-QA-109：可复用 Prompt 页面仍保留旧“当前平台”E2E 断言

- 类型：测试/页面合同漂移
- 严重程度：P2
- 状态：确认
- 实际：全量 E2E 为 `51 passed / 1 failed`；失败定位在 `frontend/tests/e2e/mvp-flow.spec.ts:494`。
- 根因：测试仍以 `platform_profile_id` 打开 Prompt 管理并等待“当前平台：……”；当前页面以 `platform_prompt_id` 选择可复用 Prompt，并展示“使用平台”绑定摘要。
- 当前实现：`frontend/src/features/configuration/PlatformPromptsPage.tsx:56-57,475-490`。
- 影响：全量 E2E 无法全绿，但其余 51 项已执行；该失败不证明当前可复用 Prompt 业务逻辑错误。
- 修复边界：只同步 E2E 到当前可复用 Prompt 合同，不恢复一平台一 Prompt 的旧页面模型。

### PS-QA-110：当前全量前端 Vitest 补跑异常挂起

- 类型：测试执行稳定性
- 严重程度：P2
- 状态：确认一次，待定向定位
- 实际：收尾执行 `make test-unit` 时，后端 `140 passed`；前端 Vitest 输出既有 CSS/jsdom 噪声后，一个 fork worker 持续占满 CPU，超过两分钟未结束。
- 处置：只终止本轮启动的进程组，没有修改代码或测试；按失败归因规则不重复执行同一未变化命令。
- 已有对照：首次全项目基线的前端 `174 passed` 与视觉合同 `23 passed`；产品修复任务的 `ContentTasksPage.test.tsx` 17 项、取消弹窗 2 项、`AppLayout.test.tsx` 19 项均通过。
- 影响：当前全量前端单测补跑不能记为 PASS，但没有证据把该挂起归因于本轮仅新增的隔离后端探针和 Markdown 报告。
- 边界：后续测试门禁任务应使用项目 `frontend/vitest.config.ts` 定位最后运行用例、worker 清理和未关闭句柄；脱离该配置的命令结果无效。

## 3. 已关闭的历史问题

以下问题已由归档任务 `07-31-product-ui-ux-defect-fixes` 修复并由恢复后 E2E 验证：

- PS-QA-001：GEO 打印内容宽度为 0。
- PS-QA-002：内容任务表真实 200% zoom 下产品列越界。
- PS-QA-003：取消任务确认缺可见取消按钮。
- PS-QA-004：自然化 Prompt 缺失时未稳定返回 409。

以下门禁问题已由归档任务 `07-31-acceptance-gate-restoration` 关闭，不再作为产品缺陷：

- PS-QA-101：生成可靠性 Prompt 夹具漂移。
- PS-QA-102：迁移 head 与历史 Prompt 所有权断言漂移。
- PS-QA-103：24 表 E2E 未关闭特殊 Modal。
- PS-QA-104：Trusted Types 测试壳层与 Vite 不兼容。
- PS-QA-105：Prompt DELETE 使用旧路径。
- PS-QA-106：管理员路由 403 预期漂移。
- PS-QA-107：Prompt 视觉基线过期。
- PS-QA-108：正式 E2E 数据未隔离。

## 4. 产品决策项

### PS-QA-D01：GEO 趋势口径

- 状态：已决策并同步。
- 结论：发现率、提及率、准确率 3 项为正式趋势；旧设计中的五项口径已由门禁恢复任务同步。

### PS-QA-D02：固定操作菜单是否统一由服务端提供 `available_actions`

- 状态：未决策。
- 内容任务、发布记录、GEO 观测已使用服务端逐行动作。
- AI 渠道/Header/模型、平台、平台类型仍由前端状态和固定菜单决定，服务端在执行时最终拒绝。
- 当前 OpenAPI 未统一要求所有列表返回 `available_actions`，因此本轮不直接判为实现缺陷。
- 建议：如产品要求跨页统一操作可用性，再单独修改合同；在此之前保持服务端为最终权限和状态权威。

## 5. 未覆盖与未判定

- 未对 13 个 DELETE 分别执行双标签并发、网络迟到响应和 UI 缓存覆盖；现有高风险并发测试不能外推为全部接口通过。
- 未用真实第三方 AI 凭据执行提供商 smoke；开发适配器结果不计为真实外部服务通过。
- 产品页深色普通文字完成自动计算抽样且无失败，但没有覆盖 24 表全部状态色、图表和所有主题，不能宣称全站对比度完整通过。
- 开发容器受未跟踪旧 `frontend/vite.config.js` 影响产生代理 500；显式使用受跟踪的 `vite.config.ts` 后页面正常，判定为本机开发环境问题。
