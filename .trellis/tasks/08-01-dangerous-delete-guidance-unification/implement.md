# 危险删除说明统一实施计划

## 1. 实施顺序

- [x] 重新读取 `prd.md`、`design.md`、本计划、前端规范和 `research/delete-guidance-matrix.md`，并用 `trellis-before-dev` 完成实施前检查。
- [x] 逐项复核六个现有 `modal.confirm` 与对应服务方法，确认实现位置和副作用在规划批准后没有变化。
- [x] 按设计矩阵修改产品、事实版本、GEO 人工观测链、平台和发布账号的标题/正文，移除用户可见“物理删除”术语。
- [x] 为 AI Header 删除确认增加渠道、模型和测试结论失效说明。
- [x] 扩展五个既有 feature 测试文件，覆盖六类确认的可访问标题和影响正文；不创建新的测试脚手架。
- [x] 定向搜索六个目标源码，确认没有遗漏目标术语，且 `available_actions`、请求、错误、缓存和 `afterClose` 行为未变化。
- [x] 运行必需验证、`trellis-check` 和完整 diff 复核；只修复由本任务引入且属于当前范围的失败。
- [x] 运行 `trellis-update-spec` 判断；已有组件规范已覆盖本任务原则时记录“不需更新”，不复制同一约束。

## 2. 必需验证

### 2.1 针对性组件测试

在 `frontend/` 工作目录执行：

```bash
npx vitest run \
  src/features/product-facts/ProductsPage.test.tsx \
  src/features/product-facts/ProductFactsPage.test.tsx \
  src/features/geo-observations/GeoObservationsPage.test.tsx \
  src/features/configuration/ConfigurationPages.test.tsx \
  src/features/settings/SettingsPage.test.tsx
```

必须覆盖六类确认框的新标题与影响正文，同时保留现有删除、冲突和焦点相关断言。

### 2.2 静态质量门禁

在仓库根目录执行：

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint
```

### 2.3 范围核对

- 对六个目标源码运行定向 `rg "物理删除"`，预期无匹配。
- 核对 diff 只有 `title` / `content`、相应测试和本任务资料；不得包含后端、合同、CSS、依赖或路由改动。
- 核对 `.playwright-cli/` 与 `frontend/.playwright-cli/` 诊断产物仍未跟踪且未纳入提交。

## 3. 可选验证

必需验证通过后，只有在运行时间与环境允许时执行：

```bash
npm --prefix frontend run test
deploy/scripts/e2e-local.sh tests/e2e/mvp-flow.spec.ts --project=e2e
```

- 完整前端测试用于排除跨 feature 回归。
- 既有纵向 E2E 可补充 AI Header 真实确认框 smoke；若被已知且与本任务无关的前置断言阻断，记录精确阻断位置，不越界修复。
- 本任务不改布局、主题或 CSS，不单独重复 24 表、全部路由、真实 200% 缩放和多主题扫描；七项完成后的集中回归统一覆盖。

## 4. 质量检查

- [x] 运行 `trellis-check`，按 `prd.md`、`design.md`、前端视觉/组件/质量规范和完整 diff 检查。
- [x] 确认文案逐项对应当前服务方法，没有第二套删除规则、前端推断、静默 fallback 或新抽象。
- [x] 确认危险按钮、取消、pending、结构化错误、query invalidation、URL 与焦点恢复保持不变。
- [x] 确认没有全局替换合同、迁移、后端文档或准确的否定语境。
- [x] 对实质修改的 TypeScript 范围完成中文文件说明、注释和用户可见文本检查；文案行不需要机械注释。

## 5. 回滚点

1. 先逐对象修改文案和对应测试；任一对象与服务行为不一致时只回滚该对象，不扩展后端范围。
2. 针对性 Vitest 通过后再运行类型检查和 Lint；失败必须先归因。
3. 若真实浏览器可访问名称与 jsdom 不一致，核对 Ant Design 实际 DOM 和现有 `findRcDialog` 模式，不新增选择器兼容层。

## 6. 预计提交边界

计划一个工作提交：

```text
fix: 统一危险删除影响说明
```

工作提交仅包含六个目标页面、五个对应测试文件和本任务规划/研究资料；不包含 `.playwright-cli/`、其他未识别文件、任务归档或会话日志。

提交前必须展示精确文件清单并等待用户确认；不自动推送。工作提交完成后，归档和会话日志分别作为 bookkeeping 提交处理。

## 7. 实施结果

- 六类确认文案已按 `design.md` 矩阵更新，服务端动作、请求、错误处理、缓存刷新和焦点恢复未改动。
- 针对性 Vitest：5 个文件、61 项测试全部通过，耗时 126.78 秒。
- `npm --prefix frontend run typecheck` 与 `npm --prefix frontend run lint` 均通过。
- 定向源码搜索确认六个目标页面不再含用户可见“物理删除”；`git diff --check` 通过。
- `trellis-check` 未发现范围漂移、重复实现、静默 fallback 或跨层合同变化。
- `trellis-update-spec` 结论为无需更新：`.trellis/spec/frontend/component-guidelines.md` 已覆盖危险操作业务语言、影响正文和服务端动作键边界。
- 完整前端套件与 E2E 属可选验证；本任务不改 API、状态逻辑、布局或样式，五个目标测试文件已直接覆盖六类变更，因此本轮未重复执行。
