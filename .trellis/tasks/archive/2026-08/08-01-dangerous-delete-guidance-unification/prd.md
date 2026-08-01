# 危险删除说明统一

## 目标

修复第二轮全项目回归中的 `PS-QA-202` 与 `PS-QA-203`：危险删除确认使用业务对象、真实影响、引用阻断和不可恢复性说明，避免向管理员暴露“物理删除”等存储实现术语，并在删除 AI Header 前明确告知渠道和模型会失效。

## 背景与已确认事实

- 权威来源：
  - `.trellis/tasks/archive/2026-08/07-31-sitewide-functional-regression-testing-round-2/report.md`
  - `.trellis/tasks/archive/2026-08/07-31-sitewide-functional-regression-testing-round-2/research/findings.md`
- `PS-QA-202` 覆盖产品、事实版本、GEO 人工观测完整更正链、平台和发布账号五类确认框；当前标题或正文把“物理删除”直接展示给用户。
- `PS-QA-203` 覆盖 AI Header 删除确认；当前只有标题和按钮，没有说明服务端会停用渠道及全部模型、把模型测试状态重置为 `UNTESTED` 并清空最近测试信息。
- 六类删除的实际行为、引用阻断和关联清理已经由现有服务方法与数据库合同定义，本任务不需要也不允许建立前端删除规则。
- 已完成的 `08-01-overlay-focus-restoration` 为这些静态确认框补充了 `afterClose` 焦点恢复；本任务必须保留该行为。
- 逐对象权威映射见 `research/delete-guidance-matrix.md`。

## 根因

危险确认文案由各页面本地持有，其中五处沿用了面向实现的存储术语，AI Header 一处遗漏了已有服务端副作用。问题不在删除服务、权限、`available_actions` 或错误响应，而在用户确认层没有把权威服务行为准确翻译成业务语言。

## 范围内

1. 改写产品、事实版本、GEO 人工观测完整更正链、平台和发布账号的既有删除确认标题或正文，移除面向用户的“物理删除”措辞。
2. 每类确认继续说明其真实删除对象、不可恢复性和服务端引用阻断；存在关联清理时只说明服务端已经实施的实际行为。
3. 为 AI Header 删除确认增加影响正文：渠道及全部模型会停用，全部模型的测试状态与最近测试信息会失效，重新测试并启用前不能用于生成。
4. 在现有组件测试中增加或更新六类确认框的可访问名称、影响正文和禁用术语断言。
5. 保持现有 `available_actions`、管理员边界、Dropdown、确认按钮、请求、错误展示、缓存刷新和焦点恢复行为不变。

## 范围外

- 不修改删除 API、OpenAPI、数据库合同、服务端删除实现、引用规则、审计、权限或状态投影。
- 不统一所有删除操作的视觉组件，不新增文案注册表、共享常量、确认框包装层或第二套删除规则。
- 不修改内容任务、发布记录、用户、AI 渠道/模型、平台类型、Prompt 等不属于 `PS-QA-202`/`203` 的删除文案。
- 不把用于准确说明“不会删除发布历史”等否定语境中的技术边界做全局替换。
- 不处理 favicon、Timeline 兼容、24 表门禁、验收文档或剩余集中回归。

## 需求

1. 用户可见标题使用“删除<业务对象>”，不得使用“物理删除”等存储实现术语。
2. 产品确认必须说明只删除产品及当前事实工作区，并精确列出事实版本、内容任务和 GEO 观测三类引用会阻断删除。
3. 事实版本确认必须说明从属审核记录会一并删除，内容任务或内容版本引用会阻断删除。
4. GEO 确认必须说明当前人工观测所属的完整更正链会一并删除，失去全部引用的证据文件进入既有清理流程。
5. 平台确认必须说明平台配置被删除、Prompt 模板不会随之删除，内容任务或平台账号引用会阻断删除，既有历史不会被改写。
6. 发布账号确认必须说明发布记录引用会阻断删除。
7. AI Header 确认必须说明渠道及全部模型停用、全部模型测试状态重置且最近测试信息清除；不得通过前端状态推断或改变服务端行为。
8. 六类确认均保留危险按钮语义、取消入口、`afterClose` 焦点恢复和原请求路径。

## 验收标准

- [x] AC1：五类 `PS-QA-202` 删除确认的标题和正文均不再出现“物理删除”，对象名称及不可恢复性清晰可见。
- [x] AC2：产品确认精确说明产品及当前事实工作区的删除范围，以及事实版本、内容任务、GEO 观测三类服务端引用阻断。
- [x] AC3：事实版本确认精确说明从属审核记录清理，以及内容任务、内容版本两类服务端引用阻断。
- [x] AC4：GEO 确认精确说明完整更正链删除和无引用证据文件清理，不暗示只删除当前链节点。
- [x] AC5：平台确认精确说明 Prompt 模板保留、内容任务/平台账号引用阻断和既有历史不改写。
- [x] AC6：发布账号确认精确说明发布记录引用阻断。
- [x] AC7：AI Header 确认在提交前明确说明渠道及全部模型停用、模型测试状态重置为未测试、最近测试信息清除，以及重新测试并启用前不可用于生成。
- [x] AC8：六类确认继续使用原 `available_actions`、请求、错误、缓存与焦点恢复流程；后端、合同、CSS、依赖和路由无改动。
- [x] AC9：对应组件测试覆盖新的可访问标题和影响正文；针对性 Vitest、前端类型检查和 Lint 通过。

## 权威实现位置

- 用户确认配置：
  - `frontend/src/features/product-facts/ProductsPage.tsx`
  - `frontend/src/features/product-facts/ProductFactsPage.tsx`
  - `frontend/src/features/geo-observations/GeoObservationsPage.tsx`
  - `frontend/src/features/configuration/PlatformsPage.tsx`
  - `frontend/src/features/settings/SettingsPage.tsx`
  - `frontend/src/features/configuration/AIChannelDetailPage.tsx`
- 服务端真实副作用：
  - `backend/app/services/product_facts.py::delete_product`
  - `backend/app/services/product_facts.py::delete_fact_version`
  - `backend/app/services/geo_observation.py::delete_geo_observation`
  - `backend/app/services/platform_configuration.py::delete_platform_profile`
  - `backend/app/services/publication.py::delete_platform_account`
  - `backend/app/services/ai_configuration.py::delete_ai_channel_header`
  - `backend/app/services/ai_configuration.py::invalidate_channel_models`
- 稳定交互约束：`.trellis/spec/frontend/component-guidelines.md`。

## 依赖与阻塞问题

- `08-01-overlay-focus-restoration` 已完成并提交，本任务可直接实施，但必须保留其 `afterClose: restoreFocus` 接入。
- 本任务不依赖 favicon、24 表门禁或验收文档任务，也不阻塞它们独立规划。
- 阻塞问题为空；精确文案和行为边界已由权威报告、当前服务实现及前端规范收敛。
