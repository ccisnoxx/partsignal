# 开发环境前端 API 代理恢复：实施计划

## 0. 开工门禁

- [x] 用户批准当前 `prd.md`、`design.md`、`implement.md` 后，另行授权运行 `python3 ./.trellis/scripts/task.py start 07-31-dev-frontend-api-proxy-restoration`。
- [x] 运行 `trellis-before-dev`，完整读取本任务三份文档及 `.trellis/spec/frontend/quality-guidelines.md`、`.trellis/spec/infra/e2e-isolation.md`。
- [x] 确认主工作区仍在 `main`；保留 `.playwright-cli/` 和 `frontend/.playwright-cli/` 等无关未跟踪文件，不创建分支。

## 1. 固化根因证据

- [x] 记录代理 `/api/v1/auth/me` 返回 HTTP 500 与 Vite `ECONNREFUSED`。
- [x] 记录 API 直连和前端容器内 `http://api:8000/api/health/live` 均为 HTTP 200。
- [x] 使用 Vite `resolveConfig` 记录实际选择 `/app/vite.config.js` 和 `target=http://localhost:8000`，并与容器环境变量、`vite.config.ts` 对照。
- [x] 不在诊断阶段修改 DNS、Compose 网络、API 地址或本地生成文件。

## 2. 最小修复

- [x] 只修改 `frontend/package.json` 的 `dev` 脚本，显式增加 `--config vite.config.ts`。
- [x] 不改 `vite.config.ts`、Compose、E2E 脚本、锁文件或后端。
- [x] 检查 JSON 可解析，并运行 `npm --prefix frontend run dev -- --help` 或等价只读命令确认参数由 npm 脚本传给 Vite；不得另建包装脚本或测试配置解析器。

## 3. 必需验证：开发容器

重启现有前端服务并等待代理健康：

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml restart frontend
curl --fail --silent --show-error http://127.0.0.1:5173/api/health/live
```

- [x] `/api/health/live` 返回 HTTP 200。
- [x] 无会话 Cookie 的 `/api/v1/auth/me` 返回合同规定的 HTTP 204；使用结构正确的错误凭据调用 `/api/v1/auth/login` 返回服务端认证错误，而不是 Vite HTTP 500。
- [x] 使用项目 `playwright-cli` 打开 `http://127.0.0.1:5173/login`，以开发环境有效账号完成真实登录，进入工作台并确认 `/api/v1/auth/me` 返回 HTTP 200。
- [x] 检查前端容器本次重启后的日志，没有新的 `/api` `ECONNREFUSED`。

## 4. 必需验证：隔离 E2E

- [x] 暂停占用 `127.0.0.1:5173` 的 Compose 前端容器，保留其他开发服务。
- [x] 在已导出本地测试 `DATABASE_URL`、`REDIS_URL` 和种子密码的环境中，运行一个包含真实共享数据登录准备的现有用例：

```bash
PLAYWRIGHT_HTML_OPEN=never deploy/scripts/e2e-local.sh \
  tests/e2e/theme.spec.ts \
  --project=e2e \
  --grep "匿名根路径经过无内容会话探测进入登录页且 CLS 达标"
```

- [x] Playwright 零失败；隔离数据库和临时存储均输出 `status=deleted`。
- [x] 无论 E2E 成功或失败都恢复 Compose 前端容器，并再次确认代理健康检查通过。

## 5. 静态与差异检查

```bash
npm --prefix frontend run typecheck
git diff --check
git status --short
```

- [x] 最终代码差异只包含实现根因修复所需的 `frontend/package.json`；任务文档按实际结果补充验收证据。
- [x] 没有提交 `.playwright-cli/`、旧 `vite.config.js/.d.ts`、测试产物或其他无关文件。
- [x] 不运行完整前端、后端或全量 E2E；当前变更只影响开发启动参数，定向运行时验证和隔离真实登录覆盖直接风险。

## 6. 完成与提交前检查

- [x] 对照 AC1–AC7 记录命令、状态码、浏览器登录、重启和 E2E 清理证据。
- [x] 复核没有硬编码容器 IP、第二代理层、兼容回退、隐藏错误或无关重构。
- [x] 本任务不改变公开 API、数据、认证规则或用户文档；已将受支持 Vite 启动必须显式选择 `vite.config.ts` 的稳定约束同步到前端质量规范，不修改 OpenAPI、数据库合同或业务设计文档。
- [x] 提交代码前向用户展示精确提交范围并等待确认；不自动推送。
