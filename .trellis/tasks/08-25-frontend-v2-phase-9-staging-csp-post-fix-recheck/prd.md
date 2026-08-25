# Frontend V2 Phase 9 Staging CSP post-fix recheck

## 目标

将包含 Zod `jitless` 修复的固定 candidate 安全部署到 Staging，先证明匿名 `/login` 的 TrustedScript P1 已关闭，再完成此前因 fail-fast 未执行的完整 Browser Gate，最终把 Staging Gate 明确判定为 `MET` 或 `NOT_MET`。

## 规划时已确认事实

- 新 candidate 固定为 `2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9`；Task 分支从该 clean `main` 创建。
- 规划时 live `origin/main` 为活动 Staging candidate `0e472399bc09a82ffba7e16ca4f245b01267d475`；本地 `main` 单向超前 7 个提交，分叉计数为 `0/7`。
- 相对 `0e472399...`，产品代码只修改 `frontend-v2/src/main.tsx` 与 `frontend-v2/tests/e2e/auth-session.spec.ts`：入口先启用 Zod `jitless` 再加载 providers，并增加严格 CSP 的 Auth production-artifact 回归；backend、contracts、deploy 与 V1 产品代码无差异。
- 规划时 Hostdzire 活动 release 为 `mvp-20260825-160838-0e472399bc09`：V2 frontend 与 candidate backend 正常运行，DB revision=`0043_geo_platform_identity`，HTTP baseline 为 `MET`。
- `/root/partsignal/current` 仍指向 `releases/mvp-20260806-195740-afb1b8c82f40`；它只是上一完成验收的记录，不是流量开关。
- 当前活动 candidate 的 backend/V1/V2 image、fresh backup、activation audit 和 protected snapshot 均存在；未执行 fallback/restore。
- 上一 Browser Gate 的唯一 P1 是匿名 `/login` 加载 Zod schemas chunk 时触发 TrustedScript CSP error；仓库内修复及 production artifact 回归已通过。

## 范围内要求

1. 唯一新 candidate 必须始终是 `2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9`；不得用 floating `main`、变化后的 HEAD、未提交文件或临时 patch 替代。
2. Source Gate 必须先满足 `main=origin/main=fixed candidate`；push 需单独授权且不得 force。
3. 固定新 release 为 `mvp-20260825-172239-2a6fd940b848`；该 release 已只读确认在 Hostdzire 不存在。
4. 新 release 必须冻结 candidate-aligned V1 UI、V2 UI、backend 三个固定 tag 与实际 `sha256:` image ID；未知 image ID 必须在构建后显式记录，不得预猜。
5. 部署前必须确认现有 candidate-aligned V1 artifact、backup、protected snapshot 仍存在，并在任何运行态变化前为新 candidate 构建新的 V1 fallback artifact、创建 fresh backup 和记录 before snapshot。
6. 按 Runbook 走完整发布；不得使用 fast outer script、`PARTSIGNAL_DEPLOY_MODE=fast`、未提交复制或跳过 preflight/migration/seed。
7. DB 保持 forward-only，最终 revision 仍为 `0043_geo_platform_identity`；禁止历史 backend、downgrade、restore 或兼容 fallback。
8. 部署后先执行 HTTP Gate；任一 Required 项失败立即停止，不创建浏览器 session、不更新 `current`、不自动 fallback。
9. HTTP Gate 全绿后，使用唯一 `playwright-cli` session `frontend-v2-p9-staging-csp-post-fix-recheck`，先执行 blocker-specific Browser Gate，再执行完整 Browser Gate。
10. 浏览器只读验收需要单独登录授权；凭据只读入自动化内存，不输出、不写入文件，不保留 trace、video、截图或 storage state。
11. 结束前 logout、关闭 Task 专属 session，并确认没有遗留 browser/server；不得使用 `close-all` 或 `kill-all`。
12. 只有 HTTP Gate、完整 Browser Gate、protected-state 检查全部通过且 open P0/P1/P2=`0/0/0`，才可在单独授权后更新 `current` 并判定 Staging Gate=`MET`。
13. 任一 Required 项失败判 `NOT_MET`，保持现场；fallback/restore 必须针对精确 release、image ID 和命令另行授权，且成功也不能把失败的 Gate 改判为 `MET`。

## 验收标准

### Source 与 artifact

- [x] `main=origin/main=2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9`，且发布工作树干净。
- [x] release 精确为 `mvp-20260825-172239-2a6fd940b848`，归档 checksum 已记录且归档不含禁止条目。
- [x] `partsignal-backend:<release>`、`partsignal-frontend-v1:<release>`、`partsignal-frontend:<release>` 的 image ID 已冻结。
- [x] fresh backup 非空；preflight、full deploy、migration/seed 和健康检查均按 Runbook 完成。

### HTTP Gate

- [x] 公网与回环 live/ready 正常，匿名 `/api/v1/auth/me=204`。
- [x] `/`、`/index.html`、`/login` 与代表 deep link 为 V2 SPA artifact，标题为 `PartSignal Frontend V2`。
- [x] 所有实际 hashed JS/CSS 加载成功；HTML/client fallback=`no-cache`，hashed assets=`immutable` 且 `Vary: Accept-Encoding`。
- [x] missing asset=`404`、主 JS `.map=404`、容器内无 `.map`、全部 JS 无 `sourceMappingURL`。
- [x] CSP、Trusted Types、HSTS、COOP、frame、nosniff、Referrer-Policy 正确且唯一；CSP 不含 `unsafe-eval`，Trusted Types 未放宽。
- [x] 6 次公网/回环稳定性探针通过，时间窗内无新的 Nginx premature-close 记录。

### blocker-specific Browser Gate

- [x] 匿名 `/login` 标题为 `PartSignal Frontend V2`，登录表单可见、可编辑、提交按钮可用。
- [x] `securitypolicyviolation=0`、TrustedScript error=`0`、`console.error=0`、`pageerror=0`。
- [x] 非预期 `requestfailed=0`；匿名 `/api/v1/auth/me=204` 被视为正常。

### 完整 Browser Gate

- [x] ADMIN 登录、session restore、logout 通过；ENGINEER 首次改密后 fresh 登录通过，URL-preserving ADMIN 403 与服务端 `PERMISSION_DENIED` 权限矩阵通过。
- [x] Workbench、Products detail/fact、Content workspace、Publishing list、GEO detail、Configuration/System 通过；Workbench 与 Publishing 无现有详情 link 时，canonical empty state 与对应成功 API 均通过。
- [x] direct、refresh、Back、Forward 与 URL/canonical 页面状态一致。
- [x] 375、768、1024、1440 均无根溢出或不可达关键内容；1024 使用当前已有 Content workspace 完成真实 workspace 覆盖。
- [x] 导航、菜单与键盘焦点可达，账户菜单关闭后在 500ms 条件等待内恢复焦点，runtime 全零。

### Protected state 与结论

- [x] activation 前后仅出现 full deployment 允许的 candidate 变更；最终 backend services 同一 image、DB=`0043`、Nginx owner 未漂移。
- [x] Browser Gate 前后 protected snapshot、migrate container 集合、Nginx 与 `current` 未发生未授权变化。
- [x] HTTP、blocker-specific、完整 Browser 与 protected-state Gate 已通过，open P0/P1/P2=`0/0/0`。
- [ ] `current` 等待对固定 release 的单独授权，当前保持旧值。
- [ ] 最终报告包含 actual release/image ID/远程动作、HTTP/Browser/protected-state 证据、fallback/restore 状态、open P0/P1/P2 和明确 `MET`/`NOT_MET`。

## 不在范围

- 不修改产品代码、业务 API、OpenAPI、数据库 schema/migration、权限、部署机制、CSP 或 Nginx。
- 不执行 legacy routing、production-like rehearsal、production artifact/cutover、production 操作或其他 Phase 9 Task。
- 不删除 `frontend/`、V1 source/image/release、backup、audit 或持久数据。
- 不自动 push、部署、登录、更新 `current`、fallback/restore、commit、merge 或 archive。

## 阻塞问题

无产品或方案问题。HTTP、Browser 与 protected-state Gate 均已通过；本 Task 证据提交与归档已授权，`current` 更新仍需对固定 release 的单独授权。
