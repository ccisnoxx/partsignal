# 前端轻量资源与兼容清理实施计划

## 1. 实施顺序

- [x] 读取 `prd.md`、`design.md`、本计划、研究记录和相关前端规范，并运行 `trellis-before-dev`。
- [x] 完整读取入口 HTML、公开资产检查及其测试、发布详情及对应测试，确认规划批准后实现未变化。
- [x] 新增 `frontend/public/favicon.svg`，复用现有紧凑 PartSignal 矢量标记，并在 `frontend/index.html` 显式声明。
- [x] 扩展 `check-production-assets.mjs` 与其最小夹具测试，锁定声明和构建产物存在性。
- [x] 将 `PublicationDetailPage.tsx` 唯一旧 Timeline item 字段从 `children` 改为 `content`。
- [x] 扩展现有发布详情测试，保留状态轨迹内容断言并锁定无目标弃用警告。
- [x] 运行必需验证、`trellis-check`、完整 diff 和范围复核；只处理由本任务引入且属于当前范围的失败。
- [x] 运行 `trellis-update-spec` 判断；已有规范覆盖时记录无需更新，不复制同一约束。

## 2. 必需验证

### 2.1 公开资产门禁测试

在 `frontend/` 工作目录执行：

```bash
node --test scripts/check-production-assets.test.mjs
```

必须证明正确 favicon 通过，缺失/错误声明或资产时失败。

### 2.2 发布详情组件测试

在 `frontend/` 工作目录执行：

```bash
npx vitest run src/features/publications/PublicationsPage.test.tsx
```

必须证明状态轨迹内容保持可见，且没有 Ant Design `items.children` 弃用消息。

### 2.3 静态质量和生产资产

在仓库根目录执行：

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
```

`build` 必须生成并通过检查的 `frontend/dist/favicon.svg`。

### 2.4 范围核对

```bash
git diff --check
rg -n -U 'status_events\.map\(\(event\) => \(\{\n\s+children:' frontend/src
```

- 第二条命令预期无匹配；`Descriptions` 合法使用的 `children` 不属于 Timeline 合同，其他 Timeline 文件不做机械改写。
- diff 只包含任务资料、入口/图标、公开资产门禁及测试、发布详情及测试。
- `.playwright-cli/` 与 `frontend/.playwright-cli/` 保持未跟踪且不进入提交。

## 3. 可选验证

```bash
npm --prefix frontend run test
npm --prefix frontend run e2e -- tests/e2e/theme.spec.ts --project=e2e --grep "匿名根路径经过无内容会话探测进入登录页且 CLS 达标"
```

- 完整前端测试用于排除跨 feature 回归。
- 真实浏览器可用时，使用项目 `playwright-cli` 新会话检查 `/login` 的 favicon 请求/console，并检查发布详情 Timeline console；诊断产物不提交。
- 若 E2E 被当前本地栈或共享数据准备阻断，记录精确原因，不修改环境或扩大任务。

## 4. 风险与回滚点

1. favicon 声明和文件必须同批完成；只加其中一个仍会产生无效请求。
2. 资产门禁正常夹具与失败夹具必须同时更新，避免只让当前构建偶然通过。
3. Timeline 只改字段名；若状态轨迹内容变化，立即回滚并核对 JSX 是否被误改。
4. 不通过 console 过滤、警告白名单或测试环境替身掩盖兼容警告。

## 5. 预计提交边界

计划一个工作提交：

```text
fix: 清理前端资源与 Timeline 兼容问题
```

工作提交预计只包含：

- `frontend/index.html`
- `frontend/public/favicon.svg`
- `frontend/scripts/check-production-assets.mjs`
- `frontend/scripts/check-production-assets.test.mjs`
- `frontend/src/features/publications/PublicationDetailPage.tsx`
- `frontend/src/features/publications/PublicationsPage.test.tsx`
- 本任务的 `task.json`、`prd.md`、`design.md`、`implement.md` 和研究记录

提交前必须展示精确范围并等待确认；不包含任务归档、会话日志、Playwright 诊断产物，也不自动推送。

## 6. 实施与验证结果（2026-08-01）

- 公开资产门禁测试：5 项通过，0 失败；缺失 favicon 声明与缺失 favicon 文件都会返回非零。
- 发布管理定向 Vitest：1 个文件、16 项通过，0 失败；状态说明仍显示，且未出现目标 Timeline 弃用消息。进程输出保留项目既有的 jsdom CSS 解析提示，没有过滤 console。
- `typecheck`、`lint`、`build` 均通过；构建耗时 2.78 秒，`dist/favicon.svg` 存在并通过生产公开资产检查。
- 新 `playwright-cli` 会话访问本地预览 `/login`：HTML 与资源均返回 200，favicon 类型为 `image/svg+xml`，静态请求中没有 `/favicon.ico`。本地后端未启动导致 `/api/v1/auth/me` 独立返回 500，与本任务静态资源无关。
- `git diff --check` 通过；全仓 `status_events` Timeline 不再存在 `children` item 字段。
- 可选完整前端测试未重复执行：定向发布测试已耗时约 60 秒，且改动未触及共享业务合同；完整回归留给七项任务完成后的集中回归。
- `trellis-update-spec` 结论：不更新 `.trellis/spec/`。本次没有新增 API、配置或跨层合同，favicon 由现有资产门禁自验证，Timeline `content` 也已是项目其他使用点的既有模式。
