# 浮层焦点恢复实施计划

## 1. 实施顺序

- [x] 完整复核所有表格 Dropdown → `modal.confirm` 调用点，以及发布 Drawer、审计侧栏/Drawer 的状态所有者；排除直接按钮确认和非目标 Dropdown。
- [x] 新增并测试 `useFocusReturn`：记录键盘/指针触发器，恢复仍连接元素，失效元素安全结束。
- [x] 将内容任务、产品、事实版本、发布、GEO、设置、用户、AI 渠道/Header/模型、平台和平台类型的目标确认链接入 Hook。
- [x] 处理平台页同一确认函数被表格菜单与详情面板共用的边界，只让表格菜单消费表格焦点目标。
- [x] 将发布记录直接入口和记录菜单入口传给 Workspace；使用 Drawer 关闭完成回调恢复焦点。
- [x] 将审计详情按钮传给页面状态所有者；分别在桌面侧栏卸载后、移动 Drawer 关闭完成后恢复焦点。
- [x] 扩展 Hook、发布页与审计页单元测试；在既有 `mvp-flow.spec.ts` 的 AI、发布和审计流程增加真实浏览器焦点断言，不新建重复数据脚手架。
- [x] 搜索复核所有登记调用点均已接入，且普通 Modal、直接按钮确认、删除文案及业务请求没有被改动。

## 2. 必需验证

### 2.1 针对性单元/组件测试

在 `frontend/` 工作目录执行：

```bash
npx vitest run \
  src/shared/hooks/useFocusReturn.test.tsx \
  src/features/publications/PublicationsPage.test.tsx \
  src/features/configuration/AuditLogPage.test.tsx
```

若实现中为代表性 Dropdown 页面增加或修改了组件测试，将对应文件加入同一次命令。

### 2.2 静态质量门禁

在仓库根目录执行：

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint
```

### 2.3 真实浏览器回归

使用隔离 E2E 栈运行既有纵向流程中的新增焦点断言：

```bash
deploy/scripts/e2e-local.sh tests/e2e/mvp-flow.spec.ts --project=e2e
```

验证至少包括：

- AI 渠道 Dropdown → 删除确认 → 取消后回到原“更多操作”；
- 发布记录 Drawer 关闭后回到原直接按钮或“更多操作”；
- 审计详情关闭后回到原“查看日志详情”；
- E2E 隔离数据库和临时对象存储完成精确清理。

若当前 shell 未提供 `DATABASE_URL` / `REDIS_URL`，按项目既有本地 E2E 环境方式注入；不得改脚本或使用共享业务库代替隔离数据库。

## 3. 可选验证

在必需验证通过后，只有当运行时间和环境允许时执行：

```bash
npm --prefix frontend run test
make e2e
```

- 完整前端测试用于排除跨页面 Hook 接入回归。
- 完整 E2E 留给本任务风险复核或七项完成后的集中回归；针对性真实浏览器流程已覆盖本项核心行为时，不把完整 E2E 作为单项提交阻断。
- 本任务不改视觉尺寸、主题或 CSS，不重复执行全页面截图、真实 200% 缩放和所有视口扫描；这些在七项集中回归统一复核。

## 4. 质量检查

- [x] 运行 `trellis-check`，按 `prd.md`、`design.md`、前端规范和完整 diff 检查。
- [x] 确认无第二套浮层、全局 Store、DOM 选择器 fallback、轮询、定时器或新依赖。
- [x] 确认所有焦点调用使用 `preventScroll`，且恢复前检查元素仍连接。
- [x] 确认确认文案、权限、动作投影、请求、缓存与 URL 行为未变化。
- [x] 对新增/实质修改的 TypeScript 文件完成中文文件级说明和非显然分支注释检查。
- [x] 判断并更新 `.trellis/spec/`：补充 `useFocusReturn` 的受限使用合同，同步 Ant 自动恢复与已验证缺口的边界。

## 5. 实施与验证结果

- 针对性 Vitest：3 个文件、22/22 通过，实际用时 60.83 秒；jsdom 仅输出已知 CSS 解析警告。
- `npm --prefix frontend run typecheck`：通过。
- `npm --prefix frontend run lint`：通过，包含主题色守卫。
- 隔离 E2E 完成生产构建，共享数据准备和审计/身份用例通过；移动审计 Drawer 与 AI Header Dropdown → 删除确认的新焦点断言已实际执行通过。
- 使用 Redis `/14` 排除开发 Worker 与 E2E Worker 共用 `/0` 抢占任务后，纵向流程在本任务范围外的既有断言阻断：`mvp-flow.spec.ts:503` 仍期待未配置自然化 Prompt 时“自然化”按钮可用，但当前服务端 `available_actions` 合同明确不投影 `CREATE_HUMANIZATION_JOB`。该失败与本次焦点改动无关，未越界修改；它阻断了同文件后续的发布真浏览器断言。
- 发布直接入口、更多菜单入口和 Drawer 关闭回焦已由 `PublicationsPage.test.tsx` 组件回归通过；未将上述旧 E2E 合同失败纳入本任务修复范围。
- 每次 E2E 结束均输出一次性数据库与临时存储 `status=deleted`；开发前端容器已恢复运行。

## 6. 回滚点

1. Hook 测试通过后再批量接入页面；若 Hook 合同不成立，先撤销 Hook，不在页面内复制替代逻辑。
2. 页面接入后先跑针对性 Vitest 与类型检查；失败只修复由本任务引入且属于当前范围的问题。
3. 真实浏览器若仍落到 `BODY`，回到实际触发器/关闭生命周期取证，不增加选择器猜测或延迟轮询。

## 7. 预计提交边界

计划一个工作提交：

```text
fix: 恢复浮层关闭后的触发器焦点
```

仅包含本任务的共享 Hook、目标页面接入、回归测试和经判断必要的前端规范更新；`.playwright-cli/`、其他未识别文件、任务归档和工作日志不进入工作提交。

提交前必须重新展示精确文件清单并等待用户确认；不自动推送。提交完成后才进入 Trellis 收尾归档和工作日志步骤。
