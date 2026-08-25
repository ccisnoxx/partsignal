# Frontend V2 Phase 9 Staging CSP post-fix recheck 设计

## 1. 设计结论

复用现有 `git archive`、Hostdzire immutable release、`deploy-staging.sh`、Compose、外层 Nginx、原生 Docker/PostgreSQL 检查和项目 `playwright-cli`。不新增脚本、部署框架、兼容层、自动回滚或第二状态源。

执行流固定为：

```text
固定 candidate 与 release
→ Source Gate
→ 新 candidate-aligned V1 artifact + fresh backup + before snapshot
→ full deployment
→ 冻结 backend/V2 image ID 与 candidate protected baseline
→ HTTP Gate
→ blocker-specific Browser Gate
→ 完整 Browser Gate
→ protected-state 复核
→ 单独授权后更新 current
```

任一 Required 条件失败立即停止并判 `NOT_MET`；不自动进入 fallback。

## 2. 固定身份

| 角色 | 固定值 |
| --- | --- |
| candidate commit | `2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9` |
| candidate release | `mvp-20260825-172239-2a6fd940b848` |
| backend/fake-oss | `partsignal-backend:mvp-20260825-172239-2a6fd940b848` |
| candidate-aligned V1 | `partsignal-frontend-v1:mvp-20260825-172239-2a6fd940b848` |
| candidate V2 | `partsignal-frontend:mvp-20260825-172239-2a6fd940b848` |
| 浏览器 session | `frontend-v2-p9-staging-csp-post-fix-recheck` |

三个 image ID 必须在 Hostdzire 构建后用 `docker image inspect` 冻结；tag 不是身份替代品。

## 3. 为什么必须走 full

`redeploy-staging-fast.sh` 不适用于本 Task，原因均来自当前事实而非任务名称：

1. fast 脚本以 `/root/partsignal/current` 为关键路径比较基线；当前 `current` 是历史 `afb1b8c82f40` release。新 candidate 相对该基线新增 `0041`–`0043` migration 且修改 `deploy/compose.staging.yaml`，fast 资格门禁会主动拒绝。
2. 修复位于全局应用入口并直接关闭匿名登录的严格 CSP/Trusted Types P1，属于 Runbook 的高风险认证/全局启动链，要求完整发布与登录后浏览器验收。
3. fast outer script 在 live/ready/title 通过后自动更新 `current`，但本 Task 明确要求完整 Browser Gate 和 protected-state 全绿后才允许单独更新 `current`。
4. 直接设置 `PARTSIGNAL_DEPLOY_MODE=fast` 会绕过 full 的 migration/seed 边界，不是 Runbook 批准的替代路径。

因此使用附录 4.1–4.6 的完整手工发布；本候选 Nginx owner 未变化，4.5 的 Nginx install/reload 步骤不执行，只做 `nginx -t` 与 checksum 复核。

## 4. 部署状态与 protected owner

full deployment 允许：

- PostgreSQL/Redis 持久容器保持或由 Compose 确认健康；
- fake-oss/API/worker/scheduler 切为新 candidate backend image；
- frontend 切为新 candidate V2 image；
- migration 命令运行但 DB 最终仍精确为 `0043_geo_platform_identity`；
- `current` 在全部 Gate 通过前保持旧值；
- Nginx target/site/security snippet 不变。

candidate protected baseline 记录：

1. `postgres redis fake-oss api worker scheduler` 的 container ID、config image、image ID、state/health；
2. Compose project 中 `migrate` container 集合；
3. `alembic_version`；
4. Nginx target、site/security checksum 与 `nginx -t`；
5. `/root/partsignal/current`；
6. backend、V1、V2 三个冻结 image ID。

快照不得读取 container environment、数据库业务正文或凭据。

## 5. HTTP Gate

HTTP Gate 用真实公网与 Hostdzire loopback 分层证明：

- 健康：live、ready、匿名 auth probe；
- artifact：V2 标题、所有实际 JS/CSS、代表 SPA fallback；
- cache/source-map：HTML no-cache、hashed immutable、missing/map 404、无 `sourceMappingURL`；
- security：CSP/Trusted Types/HSTS/COOP/frame/nosniff/referrer；
- identity：frontend container image ID、release tag、candidate SHA 一致；
- stability：6 次间隔 6 秒的公网/回环 ready probe 与对应时间窗 Nginx 错误检查。

HTTP 任一失败时不创建浏览器 session。

## 6. Browser Gate

先运行 blocker-specific Gate，只验证匿名 `/login` 的真实首次加载和运行时错误审计。该 Gate 全绿后才输入凭据并进入完整矩阵。

完整矩阵复用真实公网域名，只读访问代表资源；资源 ID 只从页面已有链接取得，不创建业务数据。ADMIN 与 ENGINEER 凭据分别从 Hostdzire 共享环境中的精确 seed password key 读入自动化进程内存，不输出、不保存。若实际 seed password 不能登录，按 Auth Required 失败停止，不读取整个环境文件或猜测凭据。

所有路由统一监听：

- `securitypolicyviolation`；
- `console.error`；
- `pageerror`；
- `requestfailed`；
- script/style/image/font 非成功响应。

只允许浏览器主动 refresh/Back/Forward 导致且已归因的 `net::ERR_ABORTED`；未知失败不得忽略。

## 7. fallback/restore

失败不自动 fallback。若用户后续针对实际新 release、三个 image ID 和命令授权，fallback target 只能是：

```text
partsignal-frontend-v1:mvp-20260825-172239-2a6fd940b848
```

backend/API/worker/scheduler/fake-oss 与 DB 必须保持新 candidate/`0043`。精确命令继续复用 Runbook 第 5.1 节的 frontend-only `--no-deps --no-build --pull never --force-recreate` 合同；旧 release/backend 不是目标。

## 8. 停止条件

- Source Gate、archive/release、V1 artifact、backup、preflight 或任一 image ID 无法冻结：停止部署。
- full deploy、DB revision、health、Nginx、HTTP 或 Browser Required 失败：停止，不更新 `current`。
- protected state 出现未授权变化：停止所有新操作并保留证据。
- V2 restore 或 fallback 仅在另行授权后执行；不得用旧 backend、downgrade、restore、Nginx 放宽或 `current` 改写掩盖失败。
