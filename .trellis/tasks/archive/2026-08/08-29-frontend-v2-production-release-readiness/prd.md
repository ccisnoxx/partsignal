# Frontend V2 Production Release Readiness

## 目标

在不把既有 Staging 证据误当作 Production 证据的前提下，把 `hostdzire` 当前 `geo.962850.xyz` 运行边界原地转换为 Frontend V2 Production，并建立可执行、可停止、可回滚且逐阶段授权的发布标准。目标状态只保留 V2，不再保留 V1 产品、构建、发布或运行回退路径；当前已批准 Repository Readiness 实施，但不包含任何 hostdzire env、数据、Compose、Nginx、流量或清理写入。

## 背景与已确认事实

- 2026-08-29 本地仓库位于 `main`，工作树在创建本 Task 前为 clean，`HEAD=3dc09ce0e858bf09c0ffae87ac137f1f37ef6a92`。
- `hostdzire` 当前公开的 `https://geo.962850.xyz` 是 `partsignal-staging` Compose 项目：外层 Nginx 分别代理 frontend `127.0.0.1:19080`、API `127.0.0.1:19000` 和 fake OSS `127.0.0.1:19001`；它不是已建立的 Production 拓扑。
- 当前 Staging release 为 `mvp-20260825-172239-2a6fd940b848`，数据库 revision 为 `0043_geo_platform_identity`。公网 live/ready 与 Frontend V2 artifact 的 CSP、缓存、source-map 基线在只读检查中通过，但既有 legacy routing 变更没有远端 Staging 验证。
- `deploy/compose.prod.yaml` 只拥有 backend、migration、Worker、Scheduler、PostgreSQL 与 Redis，不拥有 frontend；`deploy/nginx/partsignal.conf.template` 期望宿主机静态 root `/var/www/partsignal-frontend/current`，该路径当前不存在；仓库也没有权威的 Production Frontend V2 发布与原子回滚脚本。
- 当前主机为 Debian 12、4 vCPU、约 5.8 GiB 内存、无 swap、根盘可用约 44 GiB，并与多个 Compose 项目共享资源。原地转换避免了第二套常驻 stack，但 candidate build、备份/恢复和维护窗口内的临时资源仍必须通过容量门禁。
- 当前 Staging 数据总量不足 75 MiB：PostgreSQL 约 66 MiB、Redis 约 7.8 MiB、fake OSS objects 约 592 KiB；用户已决定这些数据不进入 Production。
- 既有 production snapshot sanitization execution 与 production-like rehearsal 已按历史范围决策取消，Gate=`NOT_APPLICABLE`；这些历史 Task 不能作为生产数据、恢复或回滚就绪证据，也不能机械恢复执行。
- 用户已决定 V1 不再需要，目标是彻底切换至 V2；本计划不再构建、冻结或部署 candidate-aligned V1 artifact。Frontend 回滚只允许切回上一份已验证、与当前 backend/schema 兼容的 V2 artifact。
- 只读 inventory 的脱敏证据和观测限制记录在 `research/hostdzire-inventory-2026-08-29.md`。

## 需求

### R1 — 原地 Production 转换边界

- 复用当前 `geo.962850.xyz`、外层 Nginx、回环端口和现有 Compose project 运行边界，不并行创建第二套长期 Production stack；项目名可以作为历史 runtime ID 保留，但权威文档不得继续把转换后的环境描述为 Staging。
- 转换必须走一次完整维护窗口：冻结当前 V2 运行态和回滚证据，停止新增业务写入，原子替换 Production 配置与 candidate，再恢复服务并完成正式入口验收；不得在业务继续写入时逐项覆盖。
- 转换后的环境必须使用 Production 配置、真实对象存储与真实 AI 服务，不得继续共享 `.env.staging`、deterministic generator 或 fake OSS。fake-oss 只能在真实 OSS 验收通过且对象数据处置完成后从运行态移除。
- 公网域名、TLS 终止点、Nginx vhost 和流量切换只能在实施前只读重验后形成精确变更清单，并另取外部写授权。

### R2 — 可追溯 Candidate 与 Frontend Artifact

- Candidate 必须来自 clean `main` 且与 `origin/main` 精确一致；远端 release 不是 Git worktree，因此来源证明必须使用 release manifest、提交 SHA、文件校验和及镜像 digest，不能从 release 名推断 Git 状态。
- Frontend V2 production artifact 以当前已验证的容器发布模式为单一 owner；Production Compose 必须正式拥有 frontend service，静态 root `/var/www/partsignal-frontend/current` 路径从权威模板和文档中退役，避免两个 Production owner。
- Candidate 必须使用不可覆盖的 release/image tag；当前 V2 image 先冻结为上一份 V2 回滚目标，不允许以相同 tag 覆盖镜像。
- Artifact 门禁至少覆盖：production build、API contract、hashed chunk、deep link/SPA fallback、`/assets/*` immutable、HTML no-cache、缺失 asset 与 `.map` 为 404、JS 无 `sourceMappingURL`、外层 Nginx 独占 CSP/安全头。

### R3 — Production 配置与外部服务

- Production 配置必须满足 `backend/app/config.py` 的 fail-closed 合同，包括独立 session/encryption secrets、secure cookie、真实对象存储和生产内容生成器；验证过程只能输出键名、存在性和脱敏结果，不输出值。
- 在激活 Worker/Scheduler 前，必须验证真实 AI 与 OSS 的权限、连通性、超时和失败行为；不得用固定成功、development adapter 或放宽 `AI_ALLOW_LOCAL_HTTP` 代替。
- TLS 证书、续期 owner 与 reload 边界必须在发布前确认；只读 inventory 观测到当前证书有效期截至 2026-09-30。

### R4 — 数据保护、迁移与恢复

- 当前 Staging PostgreSQL、Redis 与 fake OSS objects 全部丢弃，不迁移、不 sanitize、不导入 Production，也不继承已取消 sanitizer Task 的协议或 Gate。
- 为保留维护窗口恢复能力，转换时先停止所有业务写入，再把 `/root/partsignal-data/postgres`、`redis`、`objects` 原子移入同文件系统、run-scoped quarantine；不得先 `rm -rf`。quarantine 不得被 Production mount、读取或当作业务数据源。
- Production 使用新建的空 PostgreSQL/Redis 目录和真实 OSS，执行 Alembic upgrade-to-head 后验证 revision、空库不变量与 migrate container 集合；Redis 只以空 broker 状态启动，fake OSS objects 不复制到真实 OSS。
- 空库必须通过生产语义明确的维护命令幂等创建 `admin` 与 `content_editor`，密码只来自独立 Production secret，不能继续暴露为“虚构开发账号”的 `seed-demo` 合同或输出。
- quarantine 保留到 Observation Gate=`MET`；之后的物理删除与旧 `.env.staging`、fake-oss container/image 清理是单独破坏性授权。默认不执行 Alembic downgrade。

### R5 — 发布、回滚与观察门禁

- 发布按 Repository Gate、Artifact Gate、Capacity/Configuration Gate、Rehearsal Gate、Remote Preparation Gate、Cutover Gate、Observation Gate 顺序推进；前一 Gate 未通过时不得进入后一 Gate。
- 每个本地写、远端配置写、备份、数据迁移/清理、数据库 migration、容器替换、Nginx reload、流量切换和回滚都是独立授权边界；本 Task 的只读授权不覆盖这些动作。
- 回滚计划必须分别覆盖 frontend-only、Nginx 配置、application container 和数据库恢复；不得通过切换 `/root/partsignal/current` 冒充运行态回滚。
- 正式切换后必须按计划观察 API 错误、Nginx 5xx/upstream 错误、容器 restart/OOM、Worker/Scheduler 异常与核心业务只读/受控写路径；达到停止阈值时停止后续阶段并按已批准回滚层处理。

### R6 — 产品与浏览器验收

- 在真实入口覆盖 `/login`、首页、核心列表、Workspace、管理员页面以及 legacy redirect；验证 direct link、refresh、Back/Forward、登录 return-to、权限拒绝和 revision conflict。
- 覆盖 Product、Content、Publishing、GEO、Configuration、System 核心流程，以及 375/768/1024/1440 响应式与 keyboard/focus/dialog/menu/status redundancy 可访问性基线。
- 浏览器验收使用项目 Playwright 规则下的独立 session 或现有测试；不得在服务器或容器安装浏览器，不得输出/持久化密码。

## 验收标准

- [x] AC1：Task 已创建，并记录 2026-08-29 `hostdzire` 只读 inventory、脱敏范围和无法观测项。
- [x] AC2：已识别当前 Staging 拓扑与仓库 Production Frontend owner 缺口，未把健康的 Staging 入口判定为 Production ready。
- [x] AC3：`prd.md`、`design.md` 与 `implement.md` 已定义范围、Gate、停止条件、验证命令、回滚点和逐阶段授权边界。
- [x] AC4：当前 Staging PostgreSQL、Redis 与 fake OSS 数据确认丢弃；旧目录先进入不挂载的同文件系统 quarantine，Production 从空状态初始化。
- [ ] AC5：Repository、Artifact、Production 配置、容量、数据恢复、production-like rehearsal、浏览器、rollback drill 与观察门禁均有当次 candidate 的新证据；历史 Staging 或已取消 Task 不替代这些证据。
- [ ] AC6：正式 Cutover 只在精确生产写授权后执行；所有门禁通过后才可判定 Production Release Ready。
- [ ] AC7：目标运行态、源码与发布链只保留 V2；V1 source/build/deploy pipeline 被删除，发布回滚只使用上一份已验证 V2 artifact。

## 不在本轮范围

- 上传 release artifact，创建远端备份，执行远端数据 profile/sanitization/restore，连接并读取业务数据库内容。
- 写入 Production/Staging 配置、环境文件、Nginx、systemd、iptables、Docker/Compose 运行态、数据库、对象存储、DNS、证书或 `current`。
- 启动、停止、重启、reload 或替换任何本地/远端服务与容器。
- 正式 Cutover、Production 业务写入、release/image/backup/持久数据清理；这些动作仍需后续精确授权。

## 已确认决策

- **D1 — Production 环境所有权**：原地转换当前 `geo.962850.xyz` 与 `partsignal-staging` 运行边界，不创建并行长期 Production stack。
- **D2 — V1 生命周期**：目标状态彻底切换到 V2，V1 source/build/deploy/runtime fallback 不保留；回滚目标改为上一份已验证 V2 artifact。
- **D3 — 当前 Staging 数据处置**：PostgreSQL、Redis 与 fake OSS objects 全部退出业务使用，不迁移到 Production；先 quarantine、后空库初始化，观察通过后另行授权物理清理。
- **D4 — Frontend 发布 Owner**：Production 继续使用容器化 V2 frontend，退役未落地的宿主静态目录方案；Frontend 回滚只切换上一份已验证 V2 image。
