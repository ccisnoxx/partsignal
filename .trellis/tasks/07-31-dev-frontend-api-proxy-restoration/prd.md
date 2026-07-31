# 开发环境前端 API 代理恢复

## 目标

恢复 Docker Compose 开发环境中由 Vite 提供的同源 `/api` 代理，使开发页面能够完成真实登录；修复必须在前端容器重启后继续生效，并且不得破坏现有隔离 E2E 链路。

## 背景与确认事实

- `deploy/compose.dev.yaml:93` 的前端服务通过 `VITE_API_PROXY_TARGET=http://api:8000` 指向同一 Docker 网络内的 API 服务。
- `frontend/vite.config.ts:14` 从 `VITE_API_PROXY_TARGET` 读取代理目标，宿主机运行时才回退到 `http://localhost:8000`。
- 2026-07-31 复现结果：
  - `http://127.0.0.1:5173/api/v1/auth/me` 与 `/api/v1/auth/login` 均返回 HTTP 500，Vite 日志记录 `AggregateError [ECONNREFUSED]`；
  - API 直连 `http://127.0.0.1:18000/api/health/live` 返回 HTTP 200；
  - 前端容器内访问 `http://api:8000/api/health/live` 返回 HTTP 200，且 Docker DNS 将 `api` 唯一解析到当前 API 容器地址；
  - 前端容器和 API 容器均连接 `partsignal-internal`，因此 API 健康、Docker DNS 和容器网络不是故障点。
- 根因已经定位：
  - Vite 实际解析的配置文件是 `/app/vite.config.js`，代理目标为 `http://localhost:8000`；
  - 该文件是绑定挂载进入容器的本地旧编译产物，未受 Git 管理，并被 `.gitignore:26` 忽略；其 `frontend/vite.config.js:8` 仍硬编码宿主机地址；
  - `frontend/package.json:7` 的开发命令未显式指定配置文件，Vite 自动发现旧 `.js` 后遮蔽了当前受版本控制的 `vite.config.ts`，最终在前端容器内连接自身的 8000 端口并被拒绝。
- `deploy/scripts/e2e-local.sh:95` 已显式使用 `--config vite.config.ts`，且上一任务的隔离 E2E 7/7 通过；隔离 E2E 与 Compose 开发容器使用不同的 API 地址边界，不能为修复开发容器而改写其宿主机回退行为。

## 范围内需求

### R1. 固定开发服务器的权威配置

- Compose 前端服务经 `npm run dev` 启动时必须显式加载受版本控制的 `frontend/vite.config.ts`。
- 保留 `VITE_API_PROXY_TARGET` 作为环境边界：开发容器使用 `http://api:8000`，宿主机隔离 E2E 继续使用 `http://localhost:8000`。
- 修复放在现有启动入口，不新增代理层、配置生成器、依赖、兼容分支或硬编码容器 IP。

### R2. 恢复开发环境代理和登录

- `/api/health/live` 经 `127.0.0.1:5173` 返回 API 的成功响应。
- 未认证 `/api/v1/auth/me` 和错误凭据 `/api/v1/auth/login` 返回服务端真实认证响应，而不是 Vite HTTP 500。
- 使用开发环境有效账号可从登录页进入工作台，随后 `/api/v1/auth/me` 返回当前用户。

### R3. 重启稳定性与 E2E 隔离

- 重启 Compose 前端容器并等待 Vite 就绪后，R2 的代理和登录结果保持不变。
- 使用现有 `deploy/scripts/e2e-local.sh` 运行至少一个包含真实登录准备流程的 Playwright 用例，测试通过且隔离数据库、临时存储均完成清理。
- 不修改隔离 E2E 的数据库、存储、端口或宿主机 API 目标合同。

## 验收标准

- [x] AC1：已用运行时证据证明 Vite 的 `ECONNREFUSED` 来自旧 `vite.config.js` 遮蔽 `vite.config.ts`，而非 API、Docker DNS 或容器网络故障。
- [x] AC2：Compose 前端通过项目开发命令启动时明确使用 `vite.config.ts`，运行时 `/api` 代理目标来自 `VITE_API_PROXY_TARGET=http://api:8000`。
- [x] AC3：经 `http://127.0.0.1:5173` 访问 `/api/health/live` 返回 HTTP 200；无会话 Cookie 的 `/api/v1/auth/me` 返回合同规定的 HTTP 204，错误凭据登录返回服务端认证错误，不再返回 Vite HTTP 500。
- [x] AC4：开发环境有效账号可在页面完成登录、进入工作台，并通过同源 `/api/v1/auth/me` 读取当前用户。
- [x] AC5：前端容器重启并重新就绪后，AC3 与 AC4 再次通过，Vite 日志没有新的 `/api` `ECONNREFUSED`。
- [x] AC6：现有隔离 E2E 的真实登录代表用例通过，退出时数据库和临时存储均报告 `status=deleted`。
- [x] AC7：没有修改后端、OpenAPI、数据库、认证规则、Compose 网络、E2E 隔离合同或生产部署配置，也没有新增依赖和代理实现。

## 范围外

- 修改 API、认证业务逻辑、账号数据、会话或权限。
- 调整生产 Nginx、生产/预发布 Compose、域名、TLS 或公开网络边界。
- 重构 Vite 配置、统一所有 npm 脚本或清理与本故障无关的本地生成文件。
- 扩展全站功能、UI/UX 或表格测试。
- 运行完整前端、后端或全量 Playwright 测试；除非实施证据表明共享配置受到额外影响。

## 技术约束

- `frontend/vite.config.ts` 是开发服务器的权威配置；旧的未跟踪 `.js` 产物不能再影响受支持的 Compose 启动入口。
- 不删除或提交当前工作区中的 `.playwright-cli/` 诊断文件。
- 本任务只允许根因修复与直接验证；任何额外失败必须先归因，不能顺手扩大修复范围。

## 验收证据

- 根因复现：修复前 Compose 代理的 `/auth/me` 与 `/auth/login` 均为 HTTP 500，日志为 `ECONNREFUSED`；API 直连和前端容器内 `http://api:8000/api/health/live` 均为 HTTP 200。Vite `resolveConfig` 实际报告 `/app/vite.config.js` 和 `target=http://localhost:8000`，而容器环境变量为 `http://api:8000`。
- 修复内容：`frontend/package.json` 的 `dev` 脚本显式增加 `--config vite.config.ts`；旧的未跟踪 `vite.config.js/.d.ts` 保留在现场且不纳入提交。
- 首次重启：Compose 前端重启后，代理健康为 200、无会话探测为 204、错误凭据登录为 401，新日志中没有代理错误；运行时配置报告 `/app/vite.config.ts` 和 `target=http://api:8000`。
- 真实登录：`playwright-cli` 从开发登录页以有效开发账号进入工作台，登录 POST、随后 `/auth/me`、CSRF、Dashboard、GEO 和产品请求均为 HTTP 200。控制台只有既有 `favicon.ico` 404，与代理修复无关。
- 隔离 E2E：标准 `e2e-local.sh` 完成生产构建，真实共享数据登录准备与目标主题用例 2/2 通过，耗时 2.0 秒；独立数据库和临时存储均输出 `status=deleted`。
- 恢复验证：隔离 E2E 退出并恢复 Compose 前端后，健康、无会话探测和错误登录再次分别为 200、204、401，新容器日志中没有代理 `ECONNREFUSED`。
- 静态检查：`npm --prefix frontend run typecheck` 与 `git diff --check` 通过。没有运行完整前端或后端套件，因为变更仅是开发启动参数，生产构建、真实开发登录和隔离 E2E 已覆盖直接风险。
- 文档检查：未修改 Python、TypeScript 业务代码或开发者可见运行文本，因此无需新增代码注释或 docstring；已在前端质量规范记录显式 Vite 配置选择合同。
