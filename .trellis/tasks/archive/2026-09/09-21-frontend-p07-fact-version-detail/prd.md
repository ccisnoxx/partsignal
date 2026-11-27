# P07 事实历史版本

## Goal

验收 `/products/$productId/facts/versions/$versionId` 的单版本只读 Markdown、产品身份、审批 metadata 与返回历史链接。

## Requirements

- 前置 P06 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 3.7 节、`08-testing-quality-and-acceptance.md` Phase 2.7、`contracts/openapi.yaml` FactVersion。
- 页面首屏只请求精确 FactVersion GET，不为补全展示额外请求 Product、Facts、Review Context、历史列表或 User。展示冻结 Markdown、状态/级别/摘要、revision、ID、创建与可选审批信息。
- 响应 `product_id` 与 URL 不符时阻断整个 snapshot；只读 Detail 不使用表单、CodeMirror、DirtyGuard 或任何业务命令。返回历史链接为 canonical URL。
- 当前候选生产预览的严格 fixture 证明从 Product Detail 进入、direct/refresh、状态、错误、焦点与四档宽度；不将 fixture 当真实数据库不变性证据。

## Acceptance Criteria

- [x] 组件测试证明唯一 GET、sanitized Markdown、metadata、身份阻断和只读边界。
- [x] 生产预览浏览器测试证明入口、导航、状态、错误和响应式。
- [x] 记录实际改动、证据与 P08 下一步。

## Scope

拥有 Fact Version Detail 页面及直接测试；不改可写事实流程。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：现有 Fact Version Detail 生产页面与合同相符，本项未修改生产代码或测试；P07 PRD 为本轮新增验收记录。
- `fact-version-detail-page.test.tsx` 1 file / 8 tests 全通过。证实精确 GET、sanitized 只读 Markdown、status/metadata/时间线、大小写无关的 product identity、跨产品快照阻断、404/403/503 与后台刷新保留。
- 当前候选生产构建预览 `fact-version-detail.spec.ts`：两个 Playwright project 共 8/8 全通过。覆盖 Product Detail 键盘入口、direct/refresh、Approved/Pending/Changes Requested、只读返回链接、错误与 retry、375/768/1024/1440 页面根无横向溢出及焦点顺序。严格 fixture 拒绝未声明 API 并审计浏览器运行错误。P06 本轮通过的 typecheck/lint 可复用，P07 无代码变化。
- fixture 只证明前端只读合同；服务端快照不可变性与真实 Product Facts 业务闭环留 P08。下一项 P08。
