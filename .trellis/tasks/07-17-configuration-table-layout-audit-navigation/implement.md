# 实施计划

## 0. 启动门禁

- [x] 用户评审 `prd.md`、`design.md`、`implement.md` 后运行 `task.py start`。
- [x] 使用 Codex inline 流程：运行 `trellis-before-dev`，不派发实现或检查子 Agent。
- [x] 确认主工作目录仍为 `main`，只保留已知用户修改 `AGENTS.md` 和 `.agents/skills/playwright-cli/`；提交不得包含它们。

## 1. 实现 AI 列设置与模型显示

- [x] 在 `AIChannelsPage.tsx` 使用 Ant Dropdown 多选菜单控制可选列；默认隐藏请求超时、请求 Header，保留 API Key。
- [x] 固定操作列并收紧默认列宽，使 1440px 内容区无需横向滚动即可看到操作入口。
- [x] 名称与模型 ID 相同时只显示一次，不同时保留两者。
- [x] 在 `ConfigurationPages.test.tsx` 覆盖默认列、列切换和两种模型显示。

定向验证：

```bash
cd frontend
npm test -- src/features/configuration/ConfigurationPages.test.tsx
npm run typecheck
```

## 2. 修复配置页面列宽

- [x] 平台管理当前规则列使用内容匹配宽度，Select 不得越出单元格；操作列固定右侧。
- [x] 平台规则按字段角色分配宽度，避免七列机械均分。
- [x] 修正平台类型、Prompt 管理和审计日志的明显失衡列。
- [x] 保留现有 mutation、确认流程、权限和错误处理。

## 3. 修复其他主要列表列宽

- [x] 修正产品、内容任务、人工发布、用户管理和业务设置列表的短字段/操作列宽度。
- [x] 每张表保留长文本弹性列；只在表格内部保留必要横向滚动。
- [x] 不改已按角色定宽且实测正常的 GEO 观测和 AI 渠道详情表格。

## 4. 迁移审计日志导航

- [x] 把审计日志改为 `/audit` 系统管理一级菜单并更新路由预取。
- [x] 为 `AuditLogPage` 增加页面内管理员守卫，移除配置中心旧路由。
- [x] 更新 `AppLayout.test.tsx`、`routePrefetch.test.ts`、`ConfigurationLayout.test.tsx` 和 `mvp-flow.spec.ts`。

## 5. 文档与验证

- [x] 更新 `frontend/README.md`，记录内容驱动列宽、必要横向滚动和固定关键操作列的约定。
- [x] 执行触及范围的中文注释、JSDoc 和开发者可见文本检查。
- [x] 运行：

```bash
cd frontend
npm run api:check
npm run lint
npm run typecheck
npm test
npm run build
```

- [x] 本地 E2E 环境可用时运行现有 `tests/e2e/mvp-flow.spec.ts`；不可用则记录阻塞与替代验证。
- [x] 运行 `trellis-check`，审计 diff 没有后端、契约、数据库、依赖、权限和业务状态变化。
- [ ] 使用 `playwright-cli` 在 1440/1024/768/375px 验证 AI 列设置、操作列、平台 Select、平台规则列宽和 `/audit` 权限；结束后退出登录并清理会话。

## 6. 提交与部署门禁

- [x] 汇报验证结果和精确提交文件，获得用户提交确认后才提交到 `main`。
- [ ] 获得用户推送/部署确认后推送 `origin/main`，按现有发布脚本重新部署。
- [ ] 部署后检查健康状态、当前版本指针、关键 API 和 Playwright 管理员/工程师验收。
