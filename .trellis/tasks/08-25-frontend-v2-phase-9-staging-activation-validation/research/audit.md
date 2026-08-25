# Frontend V2 P9 外部 Staging Gate 本地审计

- 日期：2026-08-25
- 范围：已按 A 授权完成 `hostdzire` 只读 SSH 和公网匿名 HTTP/headers 盘点；未上传、build、migrate、Compose 写操作、restart、reload、浏览器登录或回滚。
- 候选提交：`7c6e7c27de640a935662718a13ea49aa698609fe`

## 1. 启动基线

- `get_context.py` 在任务创建前显示 branch=`main`、working directory=`Clean`、active task=`0`。
- `git worktree list --porcelain` 仅列出 `/Users/sc/PycharmProjects/partsignal` 的 `main` worktree。
- `git branch --list 'codex/frontend-v2-*'` 无输出。
- 候选提交完整包含：
  - `87639ffb feat(deploy): 接入 frontend v2 staging artifact`
  - `f8d72aaa docs(frontend-v2): 延后 staging gate 验收`
  - `c71c7ed7 chore(task): archive 08-24-frontend-v2-phase-9-staging-integration`
  - `7c6e7c27 chore: record journal`
- 本地 tracking 状态为 `main...origin/main [ahead 306]`。这只能证明本地 ref 的差异，不能证明执行日远端状态；但足以确认当前不能把候选视为已推送发布来源。

## 2. 仓库声明的 staging owner

| 关注点 | 证据 | 结论 |
| --- | --- | --- |
| V2 container owner | `frontend-v2/Dockerfile`、`frontend-v2/nginx.conf` | Node 22 build + Nginx runtime；asset 404/immutable 与 SPA no-cache 分责。 |
| source map | `frontend-v2/vite.config.ts:27-30` | 显式 `sourcemap: false`。 |
| Compose frontend | `deploy/compose.staging.yaml:126-132` | service 仍名为 `frontend`，build context=`../frontend-v2`，端口 `19080:80`。 |
| outer Nginx | `deploy/nginx/partsignal.staging.conf.template:1-76` | `geo.962850.xyz`；`/api`→19000、`/object-storage`→19001、frontend→19080；outer layer 覆盖 cache。 |
| security headers | `deploy/nginx/partsignal-security-headers.conf:1-6` | CSP/Trusted Types、HSTS、COOP、frame、nosniff、referrer 的唯一仓库 owner。 |
| full deploy | `deploy/scripts/deploy-staging.sh:1-43` | full 模式构建 API/frontend、preflight、migrate、seed、健康检查。 |
| fast deploy | `deploy/scripts/redeploy-staging-fast.sh:165-185` | `compose.staging.yaml` 是关键路径；P9.1 必然触发拒绝，不能绕过。 |
| Runbook | `docs/Hostdzire部署上线流程.md:14,52,92-105,120-137` | V2 owner 变化必须完整发布；来源必须 clean/pushed/origin-main aligned；浏览器完成后才更新 `current`。 |

`deploy-staging.sh` 的 migration 与 seed 是本任务最重要的非前端副作用。A 已确认远程数据库停在 `0040_content_draft_management`，候选包含 `0041`、`0042`、`0043_geo_platform_identity`，full deploy 会实际推进数据库而不是 migration no-op。

## 3. V1 rollback owner

- V1 source、`frontend/Dockerfile`、`frontend/nginx.conf` 和 V1 build pipeline 仍在仓库中；P9.1 没有删除它们。
- Runbook 要求回滚只能进入一个已验证旧 release，确认该 release 自身 `deploy/compose.staging.yaml` 精确使用 `context: ../frontend`，再用该 release/tag 重启固定 Compose 栈（`docs/Hostdzire部署附录.md:459-488`）。
- `current` 只是验收记录；仅改软链不会切换运行容器（`docs/Hostdzire部署附录.md:455,488`）。
- A 已确认当前 V1 release、image tag/image ID、source checksum、DB revision 和运行健康，详见第 8 节。
- 如果 A 发现当前活动 frontend 已经是 V2、容器 tag 与 `current` 不一致、或 current commit 不是候选祖先，应视为现场漂移并停止。

## 4. V2 路由、Auth、App Shell 与权限

- `frontend-v2/src/routeTree.gen.ts:344-393` 列出 `/login`、`/`、Product、Content、Publishing、GEO、Settings、System 及代表 Workspace/Detail 路由；自动 code splitting 来自 `frontend-v2/vite.config.ts` 的 TanStack Router plugin。
- `_app` 在 loader 与 render 两层把匿名用户 replace 到 `/login`，把 `must_change_password` 用户 replace 到 `/account/security`（`frontend-v2/src/routes/_app/route.tsx:8-24`）。
- 登录成功和改密完成后都固定 replace 到 `/`，没有 return-to（`frontend-v2/src/routes/login.tsx:17-27`、`frontend-v2/src/routes/account/security.tsx:17-23`）。外部 Gate 应按当前合同验收，不提前实现 P9.2 redirect。
- `_admin` 直接消费服务端 Auth user 的 `account_type`；ENGINEER 被路由边界保留在原 URL 并显示聚焦 403（`frontend-v2/src/routes/_app/_admin/route.tsx:8-34`）。
- 导航只隐藏 Prompt、AI、Users、Audit 等 admin-only 入口；`/settings/platforms` 不是 admin-only。隐藏导航不是安全控制，C 还必须观察代表性 server API 403。
- App Shell 在 pathname 变化后把焦点移到主内容，并提供 desktop/mobile navigation、账户菜单和 logout；这些是 Back/Forward、direct URL 与权限验收的页面边界。

## 5. 外部事实：当前可确认与不可确认

### 本地已经确认

- 候选 commit 和四个前置 commit 的祖先关系。
- P9.1 Repository Gate=`MET`、外部 Gate=`PENDING` 的权威文档记录（`docs/frontend-v2/07-migration-plan.md:545-552`、`08-testing-quality-and-acceptance.md:414-416`）。
- 仓库期望的 Compose、Nginx、artifact、cache、CSP、source map、full/fast 和 V1 rollback 合同。
- 当前规划没有授权或执行任何外部操作。

### A 后仍不可确认

- 未直接 `ssh dmit`，因此 DMIT 生效配置和入口 owner 仍未从入口主机侧确认；本地 fake-IP DNS 返回 `28.0.0.123`，但 Hostdzire DNS 与 `--resolve` 直连均确认公网 TLS 服务位于 `179.255.101.113`。
- 当前 V1 artifact 可用，但候选迁移后的旧 backend 写兼容性不成立，因此不存在已确认安全的整栈 V1 rollback target。
- approved ADMIN、ENGINEER 和 must-change staging 账号及其安全注入方式。

### 当前 A 授权模型的能力边界

用户定义的 A 允许 `ssh hostdzire` 与公网无认证 HTTP/headers，但没有直接允许 `ssh dmit`。因此 A 可以确认 Hostdzire leg、public remote IP 与本地 `dmit` alias 的相关性，并验证公共行为；不能读取 DMIT 生效配置。若这些证据不足以确认入口归属，B 必须停止并请求一个只读 DMIT 扩展，不能把仓库文档当实时事实。

## 6. 凭据与浏览器安全结论

- `playwright-cli` 支持命名 session、`run-code --filename`、console/requests、close 和 session list，但没有 secret prompt 或 secret store 命令。
- 安全候选方式是：用户在仓库外预置权限 `0600` 的专用 JSON/环境文件；一个不含秘密、位于任务临时目录的 `run-code` helper 在 Node 内存中读取、登录并立即清空 password input/内存引用。CLI 命令只出现 helper path，不出现 credential value。
- 不使用 `fill ... "$PASSWORD"`、shell environment assignment、对话粘贴、远程 `.env.staging` 输出、state-save、trace、video 或密码页截图。
- helper 必须在同一命令内完成填充和提交；失败路径先清空 password input 再报错，避免 CLI 自动 snapshot 暴露值。
- 需要三个身份材料：active ADMIN、active ENGINEER、专用 must-change account + 当前/新密码。若没有第三个账号，严格只读验收只能证明 redirect，不能证明首次改密闭环。

## 7. 规划结论

1. 最小方案是复用现有 Runbook、Compose、Nginx、curl 和一个临时 `playwright-cli` session；不新增部署或自动回滚框架。
2. A 是 B 的硬前置；remote drift、DMIT 归属不清、V1 target 不可用、pending migration 未评估均阻塞激活。
3. 候选未被当前本地 `origin/main` ref 覆盖；push 必须作为 B 前独立 Git 授权处理，不包含在 A。
4. D 应在 B 前针对精确 V1 target 条件预授权；否则不应启动会替换固定 Compose 容器的 B。
5. 首次改密的认证写入必须在 C 授权中显式说明；不能隐藏在“只读浏览器验收”措辞下。

## 8. A 只读盘点结果（2026-08-25）

### 8.1 staging 身份与拓扑

- `hostdzire` 解析为 `root@179.255.101.113:2222`，连接主机 hostname=`scrapy`、uid=`0`、pwd=`/root`；未发生 host-key 冲突。
- `/root/partsignal/shared/.env.staging` 存在，mode=`600`、owner=`root:root`，且只读固定行精确匹配 `APP_ENV=staging`、`APP_BASE_URL=https://geo.962850.xyz`、`CORS_ALLOWED_ORIGINS=https://geo.962850.xyz`。
- Compose project=`partsignal-staging`；API/fake-OSS/frontend 仅监听 `127.0.0.1:19000/19001/19080`。Hostdzire Nginx 生效 site 为 `/etc/nginx/sites-available/partsignal-staging.conf`，监听 `10.0.0.2:443` 并代理上述端口，`nginx -t` 通过。
- 本机 `dmit` alias 解析为 `root@179.255.101.113:22`。Hostdzire 查询 `geo.962850.xyz` 返回 `179.255.101.113`，本机以 `--resolve` 直连该 IP 的 HTTPS 返回 200；但本轮未获 `ssh dmit` 授权，不能把 DMIT 生效配置标为 `CONFIRMED`。
- 结论：Hostdzire application runtime 与公网 staging URL 身份=`CONFIRMED`，DMIT 配置 owner=`UNCONFIRMED`；没有发现 production 标识或 production 操作。

### 8.2 current V1 与运行态

- `current`=`releases/mvp-20260806-195740-afb1b8c82f40`，解析目录位于 `/root/partsignal/releases/` 下。
- release full commit=`afb1b8c82f408f18cf16c5bde094d5eb59768899`，是候选祖先且本地 12 位 suffix 唯一。
- 远程 source aggregate checksum=`f94f248125eb3e0c108469b741c23cee8a424e43609332f3a1c701b887f390f5`；Compose checksum=`34d9f8c61877dcce6334bef91bf46dfadd5b642cd0b2bbcbc43cd134efd6f4fd`。
- release Compose 精确使用 V1 `context: ../frontend`，不含 `../frontend-v2`，`config --quiet` 通过。
- frontend tag=`partsignal-frontend:mvp-20260806-195740-afb1b8c82f40`，image ID=`sha256:9c1c346caf8710fe33e89eae995b9ff646d1460cef6e9cb83dbd81009d8668ec`，container=`partsignal-staging-frontend-1`、state=`running`。API/worker/scheduler 与 tag 一致，核心容器均运行且健康检查通过。

### 8.3 DB、backup 与 rollback 判定

- PostgreSQL、`alembic current` 与现有 API `alembic heads` 都为 `0040_content_draft_management`；`python -m app.cli preflight-integrity` 输出 `[]`。
- backup 目录 mode=`700`、owner=`root:root`；最近 SQL backup 时间为 2026-08-06，当前没有执行日 fresh backup。磁盘可用 `49,175,486,464` bytes；B 必须先创建并验证 fresh backup。
- 候选会依次执行 `0041`、`0042`、`0043_geo_platform_identity`。前两项为带默认值/可空列和索引；`0043` 新增 `publication_works.platform_profile_id_snapshot`，并创建 `BEFORE INSERT` trigger，要求该值非空且等于 `platform_profile_id`。
- 当前 V1 commit 在 `backend/` 中没有任何 `platform_profile_id_snapshot` 引用；候选才在 `backend/app/services/publication.py` 创建记录时赋值。故 `0043` 后旧 V1 API 的新建发布工作会被 trigger 拒绝。
- artifact 层面的上一 V1 target 精确为当前 release/tag/image/checksum；但它不满足“与候选迁移后数据库兼容”，所以现有 `up -d --wait worker scheduler api frontend fake-oss` 整栈命令不得作为已确认 rollback 执行。B 的 rollback 前置=`NOT_MET`，必须停止并另行批准 rollback 设计，不得用 Alembic downgrade 或临时改新 release context 规避。

### 8.4 配置差异

- `afb1b8c82f40..7c6e7c27` 的 staging Compose 唯一差异是 frontend build context 从 `../frontend` 改为 `../frontend-v2`；service 名、image 命名、端口和 outer Nginx upstream 不变。
- 当前 release 与候选的 outer Nginx template checksum 均为 `1e0fc84f79bea40a0fe7285fac06dac869f2768c4cb501b8f6054cbcc0c9acf2`，security snippet checksum 均为 `c946c3a33dc8f3ae078545cb37df3b6a65759ca589345ed485139bdd9148931e`；生效 snippet checksum 与仓库一致。
- V2 inner Nginx 删除 V1 对 `.map` 的专用 MIME location，统一由 `/assets/` 的存在性检查返回 404；`frontend-v2/vite.config.ts` 显式 `sourcemap: false`。V2 Dockerfile 直接执行 production build，不保留 V1 development stage/patch copy。
- 公网匿名 baseline：`/api/health/live`=200、`/api/health/ready`=200、`/api/v1/auth/me`=204、`/`=200、`/login`=200；HTML 为 `Cache-Control: no-cache`，所有采样响应均带计划中的 CSP/HSTS/COOP/frame/nosniff/referrer headers。

### 8.5 Git 来源与停止结论

- candidate=`7c6e7c27de640a935662718a13ea49aa698609fe`；本地 `origin/main`=`68001d759983cf0b8f111aa1e46c71ae9713aa36`，candidate ahead 306。A 未执行 pull/push。
- A 已完成；外部 Staging Gate 保持 `PENDING`。由于安全整栈 V1 rollback target 未成立，B 不得请求或执行，直到 rollback 方案被单独审查、写入 task 并获用户批准。

### 8.6 激活授权后的门禁状态

- 用户已授权按 `implement.md` 执行 B，但该授权不放宽既有前置门禁：本地 `origin/main` 仍未对齐固定 candidate，且 `0043` 后不存在已确认安全的 V1 整栈 rollback 命令，所以 B 仍为 `BLOCKED`，未执行任何激活动作。
- 失败策略已明确为“停止并报告，不自动回滚”。D 仍未授权；只有失败后用户另行明确授权且安全精确命令已经确认，才可执行回滚。

## 9. 公网 HTTP Gate 结果（2026-08-25）

### 9.1 通过项

- 根页面标题为 `PartSignal · GEO 内容运营`。
- 固定候选中 V1 `frontend/index.html` 使用上述标题且 `frontend/vite.config.ts`
  为 `sourcemap:true`；V2 `frontend-v2/index.html` 的标题是
  `PartSignal Frontend V2` 且 `frontend-v2/vite.config.ts` 为 `sourcemap:false`。
- 实际 hashed assets `/assets/index-B12Mu6hl.js` 与
  `/assets/index-DR1898Ft.css` 均返回 200，并带 immutable cache。
- 全部代表 SPA 路径、health endpoints、计划内安全/cache headers 与 missing asset
  404 均通过。

### 9.2 Required 失败与停止点

- `/assets/index-B12Mu6hl.js.map` 返回 HTTP 200、`application/json`、
  `Content-Length: 1640946`、immutable，`Last-Modified` 为 2026-08-06。
- map JSON 含 `file`、`ignoreList`、`mappings`、`names`、`sources`、
  `sourcesContent`、`version`；主 JS 含
  `sourceMappingURL=index-B12Mu6hl.js.map`。
- 页面标题与 source map 行为均未匹配固定候选 V2 artifact；同时该结果违反 design
  第 7 节“map 404、JS 无 sourceMappingURL”的 Required 条件。结合第 8.6 节仍无
  B 完成证据，故 Staging Gate=`NOT_MET`。
- 用户已授权浏览器 C，但依 `implement.md` 必须在 HTTP Required 失败后停止；没有
  创建 `frontend-v2-p9-staging-activation-validation` session，没有登录、业务写入、
  trace、video、storage state 或其他浏览器产物。
- 未自动回滚，D 仍未授权。公网行为与候选 V1 source marker 一致；本阶段没有执行
  SSH 复核，不能进一步断言是 current/container 未切换、入口缓存还是其他远程原因。
