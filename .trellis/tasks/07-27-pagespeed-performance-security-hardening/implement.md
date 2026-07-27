# 实施计划：PageSpeed P0/P1/P2

## 1. 实现前门禁

- [x] 读取 PRD、设计、研究证据和前端视觉/质量规范。
- [x] 核对 `ProtectedRoute`、`AuthProvider`、登录页、内联主题脚本、Nginx 模板和真实宿主配置。
- [x] 确认当前 scope 只有 P0，现有未跟踪 Playwright 快照保持原样。

## 2. 安全响应头

- [x] 新增 PartSignal 项目专属安全头 snippet，写入经计算验证的内联主题脚本 SHA-256。
- [x] production/staging HTTPS server 改用项目 snippet 和 `add_header_inherit merge`。
- [x] 新增 CSP/模板一致性检查，并接入 `deploy/scripts/test-deploy-staging.sh`。
- [x] 更新快速发布关键路径，使项目安全 snippet 变化强制走完整发布。

## 3. 认证启动 CLS

- [x] `ProtectedRoute` loading 分支使用专属 `.auth-boot`。
- [x] 在全局 CSS 中定义稳定的全视口认证启动几何，不改变 `.centered`。
- [x] 扩展 `measure-production-performance.mjs`，以五个匿名冷启动样本测量完整 `/` → `/login` CLS，并设置 `< 0.1` 门禁。
- [x] 扩展登录/主题 E2E，证明 `/` 经过 204 会话探测后进入登录页且 CLS `< 0.1`。

## 4. 最小验证

```bash
cd frontend
npm exec -- vitest run src/features/auth/LoginPage.test.tsx
PLAYWRIGHT_HTML_OPEN=never npm exec -- playwright test --project=e2e --no-deps tests/e2e/theme.spec.ts
npm run perf:production
npm run typecheck
npm run lint
npm run build
cd ..
node deploy/scripts/check-nginx-security.mjs
sh deploy/scripts/test-deploy-staging.sh
git diff --check
```

使用 Nginx 1.29.8 或同版本容器渲染 staging/production 配置，运行 `nginx -t`，再对 `/`、`/index.html`、`/assets/*` 发请求，断言缓存头与安全头共存。

Playwright 命令要求本地 Vite 服务已监听 `127.0.0.1:5173`；测试结束后停止该临时服务。

## 5. 文档与质量

- [x] 更新 `docs/operations.md`、Hostdzire 主 Runbook、附录和部署方案，记录安全头所有权、Nginx 版本、CSP 哈希、验证与回滚。
- [x] 执行独立 Trellis check；修复所有高、中严重级问题。
- [x] 检查无后端、契约、数据库、P1/P2、部署执行或无关文件变化。
- [x] 提交前展示 commit plan 并等待用户确认；不自动提交、推送或部署。

`.trellis/spec/` 不新增重复的部署安全头事实：跨环境权威已写入 `docs/operations.md`，Hostdzire 可执行步骤由主 Runbook 和附录持有，前端 CLS 契约由本任务的性能门禁与 E2E 固化。

## 6. P1 实现前门禁

- [x] 用户批准同一 PageSpeed task 进入 P1，不创建无关任务或分支。
- [x] 重新读取 PRD、设计、实施计划、前端规范、React 性能规则和 Playwright 工作流。
- [x] 核对 `App` → `AuthProvider` → `ProtectedRoute` → `/login` 调用链、静态 import、CSS 所有权、六条动画 path、Vite public 资产和 Nginx `try_files`。
- [x] 在 P0 提交 `ac0f1db` 上记录本地同口径 JS/CSS、coverage、CLS、长任务和 TBT 基线；确认线上 `/robots.txt` 当前为 SPA HTML。

## 7. P1 登录资源边界

- [x] `AppLayout` 与 `ChangePasswordPage` 改用 `React.lazy`，由 `ProtectedRoute` 的现有加载态承接 `Suspense`。
- [x] 将工作台 CSS 原样迁入 `workspace.css`，由 `AppLayout` 动态导入；`global.css` 只保留匿名入口所需规则。
- [x] 更新视觉守卫，使 `global.css` 与 `workspace.css` 继续执行相同 Token/半径/阴影约束。
- [x] 构建后确认 `index.html` 只预加载匿名入口 CSS/JS，未请求工作台 chunk；已认证路由仍加载完整工作台样式。

## 8. P1 动画与爬虫资产

- [x] 删除登录路径的 `stroke-dashoffset` 动画声明、方向覆盖和未使用 keyframes，保留静态虚线。
- [x] 增加普通动态偏好下的浏览器断言，六条 path 均无 CSS animation。
- [x] 新增 `frontend/public/robots.txt`，构建和生产预览断言 `200 text/plain`、`Disallow: /` 且不是 HTML。

## 9. P1 验证

```bash
cd frontend
npm exec -- vitest run src/features/auth/LoginPage.test.tsx src/features/auth/ChangePasswordPage.test.tsx src/app/AppLayout.test.tsx
PLAYWRIGHT_HTML_OPEN=never npm exec -- playwright test --project=e2e --no-deps tests/e2e/theme.spec.ts
PARTSIGNAL_PERF_SAMPLES=5 npm run perf:production
npm run typecheck
npm run lint
npm run build
test "$(cat dist/robots.txt)" = $'User-agent: *\nDisallow: /'
! rg -n 'stroke-dashoffset|@keyframes login-flow|animation[^;]*login-flow' dist/assets/*.css
cd ..
git diff --check
```

使用 Chromium coverage 对匿名 `/` → `/login` 运行修改前后同一脚本，记录解压源码的 total/used/unused bytes；从 `PerformanceResourceTiming` 记录 JS/CSS transfer，从 Long Task 以 `Σ max(0, duration - 50ms)` 计算 TBT。构建后再验证一个已认证工作台路由，避免只优化登录却破坏工作台样式。

## 10. P1 文档与质量

- [x] 更新 `frontend/README.md` 的生产性能说明，列明匿名首屏资源、CLS、长任务和 TBT 口径。
- [x] 在 `research/p1-evidence.md` 记录修改后数据、命令、线上验证边界和残余风险。
- [x] 执行独立 Trellis check；修复所有高、中严重级问题。
- [x] 检查无需更新 OpenAPI、数据库和运维方案：P1 不改变 API、数据或 Nginx 配置；robots 抓取策略由任务文档和静态资产表达。
- [x] 展示仅包含已识别 P1 文件的 commit plan 并等待用户确认；不部署、不推送。

## 11. P2 实现前门禁

- [x] 用户批准在同一 PageSpeed task 评估 P2，不创建分支或无关任务。
- [x] 重新读取 PRD、设计、实施计划、前端规范和 Trellis 工作流。
- [x] 核对 `index.html`、Vite 构建、静态 Nginx、线上 `/`/`robots.txt`/`llms.txt`、source map 消费者和 PageSpeed `80ms` 阻塞资源。
- [x] 确认 P2 只需一个 HTML 索引意图变更；meta description、`llms.txt`、source map 和额外阻塞优化均无明确业务收益。
- [x] 展示 P2 最终规划摘要并获得新的实施确认。

## 12. P2 最小实施

- [x] 在 `frontend/index.html` 增加唯一的 `meta[name="robots"]`，值为 `noindex, nofollow`。
- [x] 在现有主题 E2E 中断言匿名 HTML 的索引意图，不新建测试框架或辅助层。
- [x] 更新 `frontend/README.md`，记录内部索引边界以及刻意不维护 description、`llms.txt` 和公开 source map。
- [x] 不修改 Nginx、Vite source map、CSS 加载方式、后端、API 或数据库。

## 13. P2 最小验证

```bash
cd frontend
PLAYWRIGHT_HTML_OPEN=never npm exec -- playwright test --project=e2e --no-deps tests/e2e/theme.spec.ts
PARTSIGNAL_PERF_SAMPLES=5 npm run perf:production
test "$(rg -o '<meta name=\"robots\" content=\"[^\"]+\"' dist/index.html)" = '<meta name="robots" content="noindex, nofollow"'
! rg -n '<meta[^>]+name="description"' dist/index.html
test -z "$(find dist -type f \( -name '*.map' -o -name 'llms.txt' \) -print -quit)"
! rg -n 'sourceMappingURL' dist
test "$(find dist/assets -maxdepth 1 -name 'index-*.css' -print | wc -l | tr -d ' ')" = 1
test "$(gzip -c "$(find dist/assets -maxdepth 1 -name 'index-*.css' -print -quit)" | wc -c | tr -d ' ')" -lt 4096
cd ..
git diff --check
```

生产性能输出必须继续证明匿名首屏不加载工作台 CSS，CLS `< 0.1`，长任务和 TBT 不高于 P1 基线。未部署前不重跑或声称线上 PageSpeed 已改善。

## 14. P2 文档与质量

- [x] 在 `research/p2-evidence.md` 记录四个不实施项、唯一实施项、验证数据、线上边界和残余风险。
- [x] 执行 Trellis check，解决所有高、中严重级问题。
- [x] 检查没有 Nginx、后端、契约、数据库、依赖、部署或无关文件变化。
- [ ] 如需提交，重新展示包含 P1/P2 精确文件范围的 commit plan 并等待确认；不自动提交、推送或部署。
