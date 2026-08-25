# Frontend V2 Phase 9 外部 Staging Gate

## 目标

以固定候选提交 `7c6e7c27de640a935662718a13ea49aa698609fe` 为唯一来源，在分阶段授权下确认真实 staging 身份、V1 回滚基线和部署前置，使用完整 Hostdzire staging Runbook 激活已批准的 V2 artifact，并通过公网 HTTP 与真实浏览器验收把外部 Staging Gate 判定为 `MET` 或 `NOT_MET`。

本任务不实现新产品能力；价值是用真实 staging 证据关闭 P9.1 延后的外部门禁，同时始终保留 V1 源码、旧 release、镜像和可执行回滚路径。

## 背景与已确认事实

- 规划开始前主工作区位于 clean `main`，没有 active Trellis Task，没有额外 worktree，也没有匹配 `codex/frontend-v2-*` 的本地分支。
- 当前本地 `main` 为 `7c6e7c27de640a935662718a13ea49aa698609fe`；本地 tracking 状态为 `main...origin/main [ahead 306]`，因此不能假定候选已存在于远端 Git。
- `87639ffb`（P9.1 V2 staging artifact）、`f8d72aaa`（Staging Gate 延后）、`c71c7ed7`（P9.1 归档）和 `7c6e7c27`（journal）均为候选提交祖先。
- P9.1 Repository Gate=`MET`；外部 Staging Gate=`PENDING`，未执行远程发布或浏览器验收。
- 仓库声明的候选拓扑是 `geo.962850.xyz` → DMIT 公网入口 → Hostdzire Nginx → loopback API/object-storage/frontend；这些不是执行日实时事实。
- staging Compose 的 `frontend` service 已在仓库内切到 `frontend-v2/`，仍使用原 service 名、镜像变量和 `127.0.0.1:19080:80`。
- `deploy-staging.sh` 的 `full` 模式会构建 API/frontend、运行只读完整性预检、执行 Alembic migration、重启应用服务并幂等 seed；即使本任务没有 schema 变更，也不能把完整发布描述成“只改前端容器”。
- `current` 只是最后完成验收的 release 记录，不是流量开关；容器会在更新 `current` 之前被替换。
- V2 匿名保护路由会跳到 `/login`，首次改密会跳到 `/account/security`；当前登录和改密成功后固定进入 `/`，不恢复原 deep link。ADMIN route 对 ENGINEER 保留 URL 并显示聚焦的 403，服务端仍是权限最终权威。

## 范围内要求

1. 分阶段授权点固定为：A 只读盘点、B staging 激活、C 浏览器验收、D 条件回滚；一个阶段的授权不自动授权下一阶段。
2. A 必须只读确认：SSH 目标身份、staging 环境标记、公共 URL、当前 release/commit、活动镜像、Compose/Nginx owner、数据库 revision、候选迁移差异、备份前置、当前 V1 release 与精确回滚命令。
3. staging 身份必须由执行日证据建立；host-key 冲突、production 标记、目标不一致或公网入口无法归属时立即停止。
4. B 只能使用固定候选提交和完整 staging Runbook；禁止 `redeploy-staging-fast.sh`、`make staging-redeploy-fast` 或 `PARTSIGNAL_DEPLOY_MODE=fast`。
5. B 开始前必须确认候选已经由另行批准的 Git 来源同步到 `origin/main`，且本地 `HEAD`、`origin/main` 和固定候选三者完全相等；本任务不自动 push。
6. B 开始前必须确认 V1 rollback target 仍以 `frontend/` 构建、活动镜像存在、当前数据库兼容、回滚命令已只读校验，并预先取得针对该精确 target 的条件 D 授权。
7. 已有数据必须在 migration 前创建非空备份；若 A 发现 pending 或有损 migration，必须先完成对应的静态兼容审计与隔离恢复验证，不能依靠“本任务没有 schema 改动”跳过。
8. 公网 HTTP 验收必须覆盖健康端点、同源 `/api`、SPA fallback、真实 lazy/hashed chunks、缺失 asset、cache、CSP/安全头和 source map policy。
9. C 必须使用唯一 `playwright-cli` session `frontend-v2-p9-staging-activation-validation`，覆盖 `/login`、`/`、代表性列表、Workspace、Settings/System、direct/refresh/Back/Forward、匿名、首次改密、ADMIN/ENGINEER、同源 API 与运行时错误审计。
10. 浏览器凭据不得来自命令行、对话、远程配置输出、截图、trace、video、storage state 或报告。没有批准的内存注入方式和所需账号时，C 停止。
11. 首次改密会写认证状态；只有 C 授权明确包含一个专用 must-change staging 账号及一次密码变更时才执行。严格只读 C 只能验证 redirect，不能把首次改密闭环判为通过。
12. 任一激活、核心 smoke、API、CSP、chunk、fallback、登录、权限、5xx 或不可恢复资源错误命中条件时立即停止并报告失败点与已确认的回滚边界；不得自动执行 D。只有失败后用户另行明确授权，才可按当时已确认安全的精确 D 命令恢复 V1；不删除失败 V2 release。
13. 只有 A、B、C 全部完成且未触发回滚，才原子更新 `current` 并把外部 Staging Gate 标为 `MET`；回滚成功只证明恢复，不把 V2 Gate 判为通过。

## 验收标准

### A. 只读盘点

- [ ] `hostdzire` 实际身份、`APP_ENV=staging`、公共 URL、Compose project、回环端口、Nginx site 和公网响应形成一致 staging 证据，且没有 production 标记。
- [ ] 当前 release ID 对应的 commit 可在本地唯一解析，并且是固定候选的祖先。
- [ ] 活动 Compose project/service、frontend image tag/image ID、source-tree checksum 与 `current` 一致。
- [ ] 当前 V1 release 自身精确包含 `context: ../frontend`，活动 V1 页面和健康探针通过，旧镜像仍存在。
- [ ] 当前数据库 revision、候选 head、pending migration、preflight、备份目录/容量与 V1 DB compatibility 均有只读证据。
- [ ] 精确 rollback release、tag/checksum、命令和不包含的动作已经冻结。
- [ ] DMIT 入口若不能由当前授权范围直接确认，则保持“不可确认”并阻塞 B，不用仓库声明替代实时证据。

### B. Staging 激活

- [ ] 本地 clean `main`、`HEAD=origin/main=7c6e7c27...`；发布归档只来自该提交并记录 SHA-256。
- [ ] 已有数据的备份非空；所有 migration/restore 前置满足。
- [ ] 使用 `PARTSIGNAL_DEPLOY_MODE=full` 的完整 Runbook 构建并激活 V2，未调用任何 fast path。
- [ ] loopback API/frontend、Compose services、公网 live/ready/homepage 和 `nginx -t` 通过。
- [ ] 新 release、frontend image ID、实际 V2 asset 与候选来源可追溯；验收前不提前更新 `current`。

### C. 公网与浏览器验收

- [ ] `/login`、`/`、`/products`、`/content/tasks`、`/publishing/work`、`/geo/observations`、代表性 Workspace、`/settings/platforms`、ADMIN `/settings/ai`、`/system/users`、`/system/audit` 全部符合角色合同。
- [ ] 代表路径 direct、refresh、Back、Forward 均无白屏、错误 fallback、history loop 或身份丢失。
- [ ] 匿名保护路由跳转、must-change redirect/闭环、ADMIN 可达、ENGINEER URL-preserving 403 与代表性 server API 403 均通过。
- [ ] 浏览器发出的业务 API 与页面同源；实际 lazy route chunks 和静态资源全部成功。
- [ ] `/`、`/index.html` 和 client fallback 为 `no-cache`；hashed assets 为 immutable；缺失 asset 和 `.map` 为 `404`；JS 无 `sourceMappingURL`。
- [ ] CSP、HSTS、COOP、frame、nosniff、referrer policy 与缓存头共存；无 CSP violation。
- [ ] console error、pageerror、非预期 requestfailed、失败 script/style/image/font 和未解释 4xx/5xx 均为零。
- [ ] 指定 `playwright-cli` session 已关闭，`list --all --json` 不再显示其为 open；未保存 trace、video、截图或 storage state。

### Gate 结论

- [ ] `MET`：以上所有 Required 条件通过，新 `current` 精确指向已验收 V2 release，V1 source/image/release 仍完整可用。
- [ ] `NOT_MET`：任一 Required 条件失败/未执行、外部事实或凭据缺失、触发回滚、V2 未保持激活、或 V1 回滚基线被破坏。
- [ ] `PENDING`：仍在等待后续授权或尚未执行；不得等同于 `MET` 或 `NOT_MET`。

## 不在范围

- 产品代码、backend、OpenAPI、数据库 schema、权限合同或业务状态变更。
- DNS、证书、DMIT/公网代理写入；若只读证据证明其为 blocker，停止并另行规划。
- production、production-like rehearsal、production cutover 或监控框架。
- P9.2 legacy routing、legacy redirect 或全局未知路径兼容。
- 删除 `frontend/`、V1 image、旧 release、失败 V2 release、backup 或持久数据。
- 新部署框架、自动回滚框架、credential helper、APM、兼容层或完整 `make verify`。
- 未获授权的 pull、push、PR、Git 历史改写或分支操作。
