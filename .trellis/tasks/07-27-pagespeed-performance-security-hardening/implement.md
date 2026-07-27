# 实施计划：PageSpeed P0

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
