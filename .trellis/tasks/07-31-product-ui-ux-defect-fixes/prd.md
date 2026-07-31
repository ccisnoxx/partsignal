# 产品验收缺陷修复

## Goal

修复父验收与门禁恢复任务确认的 4 个产品问题：GEO 打印内容宽度为 0、内容任务表在窄屏和真实 200% zoom 下产品列越界、取消任务确认弹窗缺少可见取消动作，以及未配置自然化 Prompt 时接口错误返回 500。保持业务状态机、API、权限和删除语义不变。

## Background

### PS-QA-001：GEO 打印宽度

- `frontend/tests/e2e/compatibility.spec.ts:151-166` 在 Chromium、Firefox、WebKit 下均测得 `.app-content` 宽度为 0。
- 当前 print CSS 位于 `frontend/src/styles/workspace.css:1226-1234`。
- 影响是打印预览或导出可能空白、裁切或不可读。

### PS-QA-002：200% zoom 越界

- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts:585-614` 使用真实浏览器 tab zoom 复现。
- `frontend/src/features/content-tasks/ContentTasksPage.tsx:233-242` 的产品列失败，目标平台列通过。
- `frontend/src/styles/workspace.css:636-639,657` 中 `.task-title-cell` 固定 `min-width: 180px`，与表格压缩边界冲突。

### PS-QA-003：取消任务确认

- 列表与详情分别在 `ContentTasksPage.tsx:290-305`、`:690-695` 使用 `footer={null}`。
- 弹窗只有说明、确认主按钮和关闭图标，没有可见的“暂不取消/返回”次按钮。

### PS-QA-004：缺少自然化 Prompt 返回 500

- 独立 E2E 数据库未配置全局自然化 Prompt 时，`POST /api/v1/content-versions/{id}/humanization-jobs` 返回 500。
- `backend/app/services/content_production.py` 的 `_create_job` 在自然化分支调用 `build_humanization_input` 前，无条件断言原始生成专用的 `platform_prompt_id` 与 `platform_prompt_revision`。
- 当前合同已由 `build_humanization_input` 定义为 409 `HUMANIZATION_PROMPT_MISSING`，不得暴露 Python `AssertionError`。

## Requirements

### R1. GEO 打印

1. Print media 下 `.app-content` 必须得到非零可读宽度。
2. 文档宽度不得超过打印视口；隐藏 header/sider 后不得留下空白占位。
3. 打印标题、趋势、表格和优化建议保持可见，不为通过宽度断言隐藏内容。
4. 修复应落在共享打印布局尺寸链的最小权威位置，不按三个浏览器分别打补丁。

### R2. 内容任务 200% zoom

1. 产品列省略文本必须完全位于其 `td` 几何边界内。
2. 产品品牌、型号和事实版本仍可辨认；溢出文本继续通过键盘聚焦 Tooltip 获取。
3. 不得导致目标平台、状态、时间或固定操作列新增越界。
4. 桌面 1440、窄屏 375 和真实 200% zoom 均保持表格区域内部滚动，不产生文档级横向溢出。

### R3. 取消任务确认交互

1. 列表和详情两个取消弹窗都提供可见的次操作，文案使用“暂不取消”或同等明确中文。
2. 点击次操作、右上角关闭或 Escape 都不得发送取消请求或丢失页面上下文。
3. 主按钮继续使用“确认取消”，提交中避免重复操作。
4. 弹窗关闭后焦点返回触发按钮；鼠标和键盘均可完成确认与放弃。
5. 说明输入、revision 和服务端状态裁决保持现有行为。

### R4. 自然化 Prompt 缺失错误

1. 自然化作业不得要求原始生成专用的平台 Prompt 标识。
2. 未配置全局自然化 Prompt 时返回 409 `HUMANIZATION_PROMPT_MISSING`。
3. 不得用捕获 `AssertionError`、固定成功或测试兼容分支掩盖问题。
4. 原始生成仍必须冻结可复用平台 Prompt 的 ID、名称与 revision。

## Acceptance Criteria

- [ ] GEO 打印用例在 Chromium、Firefox、WebKit 全部通过，`.app-content.width > 0` 且无文档横向溢出。
- [ ] 打印预览人工检查可读，标题、趋势、表格和建议未丢失。
- [ ] 真实 200% zoom 下内容任务产品列所有可见行均位于单元格内。
- [ ] 1440×1000、375×900 和 200% zoom 下内容任务表无新增布局回归。
- [ ] 列表和详情取消任务弹窗均显示明确的可见取消按钮。
- [ ] 次按钮、关闭图标和 Escape 不发请求，焦点恢复到原触发控件。
- [ ] 主按钮正常提交，重复点击被加载状态阻止，服务端错误仍按现有方式显示。
- [ ] 相关 Vitest、Playwright、lint、typecheck 和 frontend build 通过。
- [ ] OpenAPI、数据库、权限和业务状态机没有变化。
- [ ] 未配置自然化 Prompt 的接口回归返回 409 `HUMANIZATION_PROMPT_MISSING`，不再产生 500。
- [ ] 原始生成 `content-markdown-v3` 快照仍包含平台 Prompt 身份和 revision。

## Out of Scope

- 修复测试夹具、Trusted Types 壳层、24 表 Modal、Prompt DELETE 或视觉基线；由 `07-31-acceptance-gate-restoration` 负责。
- 重做全站表格设计、修改其他页面列宽或新增统一表格框架。
- 改变内容任务取消/删除资格或服务端 `available_actions`。
- 补齐 13 个 DELETE 的完整回归矩阵。
- GEO 指标从 3 项扩展为 5 项。
- 改变自然化 Prompt 的配置、版本或快照合同。

## Dependencies

- 可以独立实现并运行定向测试。
- 最终全量 E2E 结论依赖 `07-31-acceptance-gate-restoration` 先恢复测试门禁。
