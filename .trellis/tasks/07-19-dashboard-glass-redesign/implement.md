# 实施计划

## 0. 启动门禁

- [x] 用户评审并明确批准 `prd.md`、`design.md`、`implement.md` 后，才运行 `python3 ./.trellis/scripts/task.py start 07-19-dashboard-glass-redesign`。
- [x] 在主工作目录确认分支仍为 `main`；保留并避开既有 `docs/Hostdzire部署上线流程.md` 修改，不创建开发分支、不提交、不推送。
- [x] 运行 `trellis-before-dev`，完整读取本任务三份文档和 frontend 规范后再编辑。
- [x] 本任务使用 Codex inline 流程，不整理 `implement.jsonl` / `check.jsonl`，不派发实现或检查子 Agent。
- [x] 不修改后端、OpenAPI、数据库、部署、依赖、共享组件 API、路由表、权限和查询 Key。

## 1. 基线与影响面确认

- [x] 记录 `git status --short --branch`，确认除既有文档和本任务目录外没有新修改。
- [x] 运行定向基线：

  ```bash
  cd /Users/sc/PycharmProjects/partsignal/frontend
  npm test -- src/features/dashboard/DashboardPage.test.tsx
  npm run typecheck
  ```

- [x] 再次搜索 `DashboardPage`、`metric-grid`、`geo-metric-grid` 和 E2E 总览断言的全部调用方，确认共享样式影响范围。

## 2. 重组总览页面

- [x] 在 `DashboardPage.tsx` 复用 `useAuth`，用真实 `display_name` 生成问候，保留统一加载、错误和双查询重试。
- [x] 顶部四张 `MetricTile` 只映射人工观测、文章结果、已推荐文章和文章推荐率；保留 `null → —` 与现有百分比换算。
- [x] 增加审核、发布、GEO 三组运营状态摘要，直接读取六个真实计数，不生成服务健康或跨单位总分。
- [x] 增加六类待办行，非零异常优先、零值降权；每行只链接现有处理路由。
- [x] 增加产品事实、内容任务、人工发布、GEO 观测四个快捷入口；使用 React Router `Link` 和现有 Ant Design 图标。
- [x] 检查新增/修改 TSX 中的中文注释、开发者可见文案和可访问名称；不添加机械注释。

## 3. 总览专属视觉

- [x] 在 `global.css` 只增加 `.dashboard-*` 样式，复用现有语义变量构建页头、指标、状态、待办和快捷入口的玻璃层级。
- [x] 保持现有 Card、链接和焦点语义；hover/active 不改变布局尺寸，状态同时包含文字或图标。
- [x] 增加 `backdrop-filter` 不支持时的总览回退，确保浅色/深色均使用不透明可读表面。
- [x] 添加 1199/959/767/419px 范围内的最小响应式规则，避免建立第二套断点或页面级横向滚动。

## 4. 测试与文档

- [x] 更新 `DashboardPage.test.tsx`：验证真实用户名、四个 GEO 指标、空推荐率、运营状态、六类待办和所有现有链接。
- [x] 更新 `mvp-flow.spec.ts` 末尾的总览断言，复用现有种子和登录流程，不创建新的 E2E 数据或截图基线。
- [x] 更新 `measure-production-performance.mjs` 的总览就绪标题，不改变测量场景、网络条件或性能门槛。
- [x] 更新 `frontend/README.md`，说明总览顶部 GEO 指标、行动计数区域和有限的高不透明玻璃表面；不重复维护 API 字段定义。

定向验证：

```bash
cd /Users/sc/PycharmProjects/partsignal/frontend
npm test -- src/features/dashboard/DashboardPage.test.tsx
npm run lint
npm run typecheck
```

## 4.1 用户反馈后的视觉校正

- [x] 对照参考图与首轮实际截图，确认偏差来自外壳配色、首屏密度、指标图标、状态排列、待办形态和快捷入口布局，而非数据契约。
- [x] 仅在 `/` 为 `AppLayout` 增加总览外壳类并将桌面侧栏缩窄为参考图比例；其他路由、导航、权限和焦点行为不变。
- [x] 将大幅 Hero 改为紧凑标题/问候，把四个真实指标保持横排并增加现有 Ant Design 图标与语义色。
- [x] 将状态改为横向摘要、待办改为表格式紧凑行、快捷入口改为 2×2，并用同一待办数组筛出重点提醒，不新增第二份业务状态。
- [x] 在 1584×995 实际视口与参考图并排目视复核，并重新检查浅色、深色、跟随系统、375/768/1024px 与键盘焦点。

## 5. 完整自动验证

```bash
cd /Users/sc/PycharmProjects/partsignal/frontend
npm run api:check
npm run lint
npm run typecheck
npm test
npm run build
```

- [x] 如任一检查失败，先判断是否为本次回归；不修改无关代码掩盖既有失败。
- [x] 构建警告与测试数量如实记录，不把服务器启动当作验证通过。

## 6. Playwright 真实页面验收

- [x] 检查本地栈并尝试现有 Docker 启动路径；Docker daemon 不可用，未安装新依赖或伪造真实后端。
- [ ] 运行现有主题和纵向闭环 E2E：主题用例 4/4 通过；`mvp-flow.spec.ts` 因真实 API 与 PostgreSQL 无法启动而未运行。

  ```bash
  cd /Users/sc/PycharmProjects/partsignal/frontend
  npx playwright test tests/e2e/theme.spec.ts tests/e2e/mvp-flow.spec.ts
  ```

- [x] 使用 `playwright-cli` 检查实际 Vite 页面 375、768、1024、1440px；因真实后端不可用，浏览器层使用冻结契约形状的响应，所有视口均无页面级横向溢出。
- [x] 验证浅色、深色、跟随系统及 `prefers-reduced-motion`；检查禁用模糊后页头、指标和面板仍可读。
- [x] 通过 Tab/Enter 操作处理入口和快捷入口，确认可见焦点、目标路由及返回后的主标题可见。
- [ ] 检查浏览器控制台和失败恢复已完成；无头浏览器无法改变 Chrome UI 缩放，仅以 720px CSS 可用宽度验证 200% 等价重排。
- [x] 保存必要的浅/深色与窄屏截图到任务研究目录作为验收证据，不把截图作为脆弱的像素基线测试。

## 7. 差异审计与规划验收

- [x] 运行 `git diff --check`，并检查 `git diff -- contracts backend deploy frontend/package.json frontend/package-lock.json` 无本任务变化。
- [x] 检查 diff 不包含虚构字段、硬编码参考数字、人员/动态、趋势、日期比较、第二份状态源、静默 fallback、广泛错误吞没或无关改动。
- [x] 检查主题颜色只来自现有 Token，新增交互均有键盘语义，注释/开发者可见文本符合中文规则。
- [x] 运行 `trellis-check` 并对照 AC1–AC11 记录证据。
- [x] 汇报修改、自动验证、Playwright 结果、文档更新和剩余风险；若用户之后要求提交，先给出精确提交计划并再次获得确认，不自动推送。

## 8. 验收结果

- 自动检查：`api:check`、lint、typecheck、18 个 Vitest 文件 / 60 个测试、build 均通过；构建保留既有主包大于 500 kB 警告。
- Playwright：主题 E2E 4/4 通过；用户反馈后的高保真截图、响应式、主题、键盘、模糊降级和 503 重试恢复记录见 `research/playwright-validation.md`。
- 环境缺口：Docker daemon 不可用，因此未运行依赖完整真实栈的 `mvp-flow.spec.ts`；无头浏览器未完成真实 Chrome 200% UI 缩放。
- 规范判断：没有 API、数据库、配置、权限、共享组件契约或可复用项目惯例变化；页面级信息架构已写入 `frontend/README.md` 和本任务文档，不重复修改 `.trellis/spec/`。
