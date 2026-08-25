# Frontend V2 Phase 9 Staging Activation Recheck

## 目标

以固定提交 `0e472399bc09a82ffba7e16ca4f245b01267d475` 为唯一 deployment candidate，按照最新 Hostdzire Staging Runbook 重新执行 Frontend V2 activation，并以真实 artifact、HTTP、浏览器和 protected-state 证据把外部 Staging Gate 明确判定为 `MET` 或 `NOT_MET`。

## 背景与已确认事实

- P9.1 Repository Gate 已为 `MET`；第一次外部 Staging Gate 因未观察到 V2 artifact、公开 source map 和不安全的历史整栈回滚而判为 `NOT_MET`。
- rollback blocker 已关闭：数据库只前进；candidate backend、worker、scheduler、fake-oss 长驻；V1/V2 只切同一 candidate 的 Compose `frontend` service。
- 只读盘点时 live `origin/main` 为 `68001d759983cf0b8f111aa1e46c71ae9713aa36`；用户随后单独授权非强制 push，当前 `main=origin/main=candidate`，来源 Gate 已满足。
- 2026-08-25 只读盘点确认 Hostdzire 为 staging：`APP_ENV=staging`、Compose project=`partsignal-staging`、公网 URL=`https://geo.962850.xyz`、回环端口 `19000/19001/19080`、Nginx `1.29.8` 且 `nginx -t` 通过。
- 当前活动栈仍是 `mvp-20260806-195740-afb1b8c82f40` 的 V1 frontend/backend，数据库 revision=`0040_content_draft_management`，candidate head=`0043_geo_platform_identity`。
- 当前公网标题为 `PartSignal · GEO 内容运营`；hashed JS/CSS 与安全头正常，但 `.map` 返回 `200` 且主 JS 含 `sourceMappingURL`，符合 V1 marker，不符合 V2 Required Gate。
- 备份目录权限和磁盘容量满足前置，但没有执行日 fresh backup。共享环境文件权限为 `0600`，Runbook 必需键均存在；账号凭据的实际可用性未通过登录验证。

## 范围内要求

1. 固定 candidate 不得被 floating `main`、后续 HEAD、未提交文件、临时 patch 或旧 release 替代。
2. 真实 activation 前必须证明 `main=origin/main=candidate`，且 release 归档只来自该已推送提交；本 Task 不自动 push。
3. migration 前从同一 candidate release 的 `frontend/` 构建并冻结 `partsignal-frontend-v1:<candidate-release>`，记录 image ID；完整发布再冻结 candidate backend 与 V2 frontend image ID。
4. 已有数据必须在 migration 前创建并验证非空 fresh backup；执行只读 preflight 后只能走 `deploy-staging.sh` 的 `full` 流程。
5. migration 只前进到 `0043_geo_platform_identity`；禁止历史 V1 backend、Alembic downgrade、旧整栈 release 回滚或数据库 restore 作为常规 fallback。
6. activation 前后记录 protected services、migrate container 集合、DB revision、Nginx target/checksum 和 `current`；fallback/restore 前后的 protected snapshot 必须字节一致。
7. HTTP Required Gate 必须先全绿，随后才创建 `playwright-cli` session `frontend-v2-p9-staging-activation-recheck` 做真实浏览器只读验收。
8. fallback 与 restore 只能使用已批准的精确 frontend-only 命令；失败不自动 rollback，任何 fallback 都需用户针对 target、image ID 和命令另行授权。
9. 只有 Required Gate 全部通过、V2 保持活动、open P0/P1/P2 blocker 为 `0/0/0`，才判定 `Staging Gate=MET`；rollback 成功不能把 Gate 判为 `MET`。

## 验收标准

### 来源与 artifact

- [ ] `main=origin/main=0e472399bc09a82ffba7e16ca4f245b01267d475`。
- [ ] 唯一 candidate release ID 含 `0e472399bc09`，归档 checksum 已记录。
- [ ] V1 UI、V2 UI、backend 三个固定 image ref 与 image ID 已记录，且运行容器身份可追溯到同一 candidate。
- [ ] fresh backup 非空；preflight、migration、seed 和 full deploy 按 Runbook 完成，无跳步或 fast path。

### HTTP Gate

- [ ] live、ready、同源 `/api`、首页和代表 SPA deep link 均通过。
- [ ] 标题为 `PartSignal Frontend V2`，真实 hashed JS/CSS 全部成功加载。
- [ ] index/client fallback=`no-cache`，hashed asset=`immutable`，missing asset 与 `.map` 均为 `404`，主 JS 不含 `sourceMappingURL`。
- [ ] CSP、HSTS、COOP、frame、nosniff、referrer policy 与缓存头正确共存。

### Browser Gate

- [ ] 登录、session restore、Workbench、Products、Content、Publishing、GEO、Configuration/System 代表只读路径通过。
- [ ] 375、768、1024、1440 四档代表布局通过；direct、refresh、Back、Forward 与 URL 状态符合合同。
- [ ] console error、pageerror、非预期 requestfailed、CSP violation 和失败资源均为零。
- [ ] Task 专属 Playwright session 已关闭，未留下 trace、video、截图或 storage state。

### Protected state 与结论

- [ ] activation 前后变化符合设计中的允许矩阵；Nginx 在本候选未变化时 checksum 保持一致，`current` 仅在全部验收通过后更新。
- [ ] 任一 frontend-only fallback/restore 前后，六个 protected services、migrate container 集合、DB revision、Nginx 与 `current` 完全不变。
- [ ] 最终报告包含实际远程动作、Gate 证据、fallback/restore 状态、changed files、checks、未解决问题和明确 `MET`/`NOT_MET`。

## 不在范围

- 不修改业务 API、schema、migration、权限、前端业务页面或部署机制。
- 不执行 legacy routing、production-like rehearsal、production artifact/cutover 或后续 Phase 9 Task。
- 不修改 DNS、证书、DMIT/Nginx，除非只读证据形成独立 blocker 后另行规划和授权。
- 不删除 `frontend/`、V1 image/source、旧 release、backup 或持久数据。
- 不自动 pull、push、rollback、commit、merge、archive 或进入 production。

## 当前阻塞前置

- Task 规划文件尚未按确认的 commit plan 提交，当前工作树不满足 Runbook clean source 前置。
- 尚未取得 package/upload、V1 build、fresh backup、full deploy、migration/seed 和 Compose 替换的 staging 写授权。
- candidate release、三类 candidate image ID 与 fresh backup 尚不存在，只能在后续精确授权的 activation 窗口中创建。
- 浏览器账号的实际有效性和安全内存注入路径尚未验证；HTTP Gate 全绿前不创建浏览器 session。
