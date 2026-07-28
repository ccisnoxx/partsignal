# Research: Hostdzire 重新上线规划风险复核

- Query: 只读复核“依据 Hostdzire 部署文档重新上线”的路径选择、发布门禁、备份恢复、维护窗口、回滚和验收风险
- Scope: internal
- Date: 2026-07-28

## Findings

### 0. 现场基线与结论

以下现场状态来自任务调度上下文，本次未连接远端复查，也未读取任何凭据值：

- 本地 `main` HEAD 为 `1417c02`，比 `origin/main` 的 `ccdab3b` 领先 5 个提交，工作树有 108 项脏改动。
- Hostdzire `current=mvp-20260727-214246-ccdab3b2f7f9`，数据库 revision 为 `0028`，共享环境文件权限为 `0600`，当前服务健康。
- `VERIFY_DATABASE_URL` 未配置。
- 数据库已有 1 条人工观测/逐篇结果，且 `recommendation_status` 或 `cited` 至少一个非空。

结论：**必须采用完整发布，且当前禁止执行发布。** 快速路径的六个门禁路径明确包含 `backend/alembic/versions/`；任一门禁路径变化都必须改走完整发布，不得绕过（`docs/Hostdzire部署上线流程.md:10-24`）。目标数据库仍在 `0028`，而待发布 head 包含 `0029`、`0030`；其中 `0029` 会无条件删除 `recommendation_status` 和 `cited`（`backend/alembic/versions/0029_manual_geo_independent_facts.py:20-41`）。现场已确认这两个字段至少有一个真实非空值，因此这是确定的数据丢失，不是理论风险。

`preflight-integrity` 不能代替这项数据处置门禁：部署脚本虽在迁移前运行它（`deploy/scripts/deploy-staging.sh:23-30`），但当前检查只覆盖“已完成任务无 VERIFIED 发布”和“未终态跨平台错绑”两类发布闭环问题（`backend/app/services/integrity.py:24-45`、`backend/app/services/integrity.py:47-105`），不会检测 `recommendation_status/cited` 的非空值。必须把“批准删除这两个旧逐篇累计事实”写成明确验收条件；不能期待 preflight 自动阻断。

### 1. 不可绕过的本地门禁

1. **Trellis 规划门禁**
   - 当前任务仍是 `planning`（`.trellis/tasks/07-28-production-redeployment/task.json:4-18`）。
   - `prd.md` 的 Requirements 和 Acceptance Criteria 仍为 `TBD`（`.trellis/tasks/07-28-production-redeployment/prd.md:7-13`）。
   - 这是数据库契约、远端配置、维护窗口和回滚均受影响的复杂任务；按工作流，复杂任务必须先有可评审的 `prd.md`、`design.md`、`implement.md`，评审后才能 `task.py start`（`.trellis/workflow.md:158-165`、`.trellis/workflow.md:438-459`）。

2. **权威源码门禁**
   - 只能从干净、已推送且与 `origin/main` 完全一致的本地主工作目录制作 release（`docs/Hostdzire部署上线流程.md:47-59`）。
   - 当前“HEAD 领先 5 + 108 项脏改动”同时违反“干净 main”和“HEAD 等于 origin/main”。不能从本地 HEAD、脏工作树、临时 worktree 或旧 release 打包（`docs/Hostdzire部署附录.md:9-22`）。
   - 必须先识别 108 项变更归属，完成相称测试，按项目 Git 规则经用户确认提交计划后提交并推送；随后重新确认 `main` 干净、`HEAD == origin/main`。在此之前连完整发布包都不能制作。

3. **本地质量与归档门禁**
   - 先完成与 5 个待发布提交相称的最小检查；迁移至少需要 PostgreSQL 的 `0028 -> 0030` 升级验证和 head 校验，部署脚本需跑现有部署脚本测试，前端/后端需跑受影响的定向检查。
   - `node deploy/scripts/check-nginx-security.mjs` 必须通过；完整发布归档必须非空、包含 `.env.example`，且不含 `.env`、密钥、私钥文件或 AppleDouble 条目（`docs/Hostdzire部署附录.md:154-195`）。
   - release ID 必须使用秒级时间戳和 12 位提交号，且不可复用（`docs/Hostdzire部署附录.md:168-195`）。

### 2. 不可绕过的远端门禁

1. 只使用 SSH alias `hostdzire` 做部署写操作；`dmit` 只允许公网入口异常时只读诊断。SSH 主机密钥冲突立即停止，不自动接受或清理（`docs/Hostdzire部署上线流程.md:41-45`）。
2. 只读确认主机身份、Docker/Compose/Nginx/PostgreSQL 客户端/gzip/curl、磁盘和内存；Nginx 必须不低于 `1.29.3`（`docs/Hostdzire部署附录.md:37-47`、`docs/Hostdzire部署附录.md:55-89`）。
3. `/root/partsignal/shared/.env.staging` 必须继续存在且权限为 `0600`；正常升级只链接它，不下载、不复制、不重新生成、不读取整个文件（`docs/Hostdzire部署附录.md:197-238`）。
4. 新 release 目录必须不存在，归档须完整解压且不含 AppleDouble，再链接共享环境文件（`docs/Hostdzire部署附录.md:211-238`）。
5. 已有数据必须先得到非空、可恢复的迁移前备份；本次为有损迁移，还必须完成隔离恢复验证（`docs/Hostdzire部署上线流程.md:89-102`）。
6. 默认 `full` 部署依次通过 Compose config、镜像构建、PostgreSQL/Redis/fake-oss、只读 preflight、Alembic head、Worker/Scheduler/API/前端健康和本机探针；不得设置 `PARTSIGNAL_DEPLOY_MODE=fast`（`docs/Hostdzire部署附录.md:269-288`）。
7. 如果 staging Nginx 模板或项目安全 snippet 变化，二者必须来自同一 release；安全检查和 `nginx -t` 通过后才能 reload（`docs/Hostdzire部署附录.md:290-310`）。
8. 只有公网、缓存、安全头、对象存储代理、浏览器和主机验收全通过后，才可原子更新 `current`（`docs/Hostdzire部署附录.md:312-396`）。当前服务健康只是旧 release 基线，不是新 release 放行证据。

### 3. 备份与隔离恢复的最小安全方案

1. **先确定数据处置**：记录迁移前 revision=`0028`、人工观测/逐篇结果计数，以及“旧字段至少有一个非空”的计数，不输出业务正文。由数据负责人明确批准 `0029` 删除旧 `recommendation_status/cited`；否则停止。
2. **建立可验证停写**：最终备份前阻断公网写请求，并停止 API 写入口、Worker 和 Scheduler；在最终备份到迁移完成、只读验收结束前不得恢复业务写入。PostgreSQL 是业务唯一来源，不能用 Redis 补偿或推断（`docs/operations.md:19-24`）。
3. **生成最终备份**：使用 release 中的 `backup.sh`，目标目录权限受限；脚本设置 `umask 077` 并执行 `pg_dump --clean --if-exists --no-owner | gzip`（`deploy/scripts/backup.sh:1-17`）。
4. **补足脚本证据缺口**：
   - `backup.sh` 使用 POSIX pipeline，`set -e` 通常只观察末端 `gzip` 的退出状态；上游 `pg_dump` 失败仍可能留下非空 gzip。因此仅 `test -s` 不能证明 dump 成功（`deploy/scripts/backup.sh:13-16`）。
   - `restore-verify.sh` 只导入后查询 `alembic_version` 和 `users`（`deploy/scripts/restore-verify.sh:7-12`），不证明验证库初始为空，也不校验人工 GEO 数据或执行目标迁移。
   - 最小补救是：对备份做 `gzip -t` 和哈希；只向**新建、空白、一次性、与 staging 主库没有共享卷/网络身份的 PostgreSQL**恢复；恢复后确认 revision 精确为 `0028`、关键表与预期记录计数一致、旧字段非空计数一致。不能复用已有“验证库”中的旧表掩盖空/残缺备份。
5. **迁移彩排**：在上述隔离恢复副本上，用待发布后端执行 `0028 -> 0030`，确认 revision 精确为 `0030_publication_record_delete`、业务主记录数量符合预期、`discovered/mentioned/accuracy` 保持、被批准删除的两列消失、关键只读查询可用。`0030` 依赖 `0029`（`backend/alembic/versions/0030_publication_record_delete.py:5-8`）。
6. **保护恢复材料**：本机 gzip 不是完整备份；还需受控的异地加密副本、校验和、保留期，并与当时的 `AI_CREDENTIAL_ENCRYPTION_KEY` 成对保护，但不读取、复制或输出该密钥值（`docs/operations.md:46-50`）。
7. `VERIFY_DATABASE_URL` 当前缺失，因此隔离恢复和彩排尚不能开始；它必须明确指向上述一次性数据库，绝不能指向 staging 主库（`docs/Hostdzire部署附录.md:240-267`）。

### 4. 维护窗口与数据库/应用回滚边界

建议把维护窗口定义为：**开始可验证停写和最终备份时起，至新 release 全部只读验收通过并明确恢复写入时止**。窗口内至少包含最终备份、隔离恢复证据确认、停止旧进程、完整部署、迁移、健康检查、浏览器只读验收和回滚判断。

现有脚本有一个不能忽略的窗口缺口：`deploy-staging.sh` 在迁移前只启动依赖服务和运行 preflight，未先停止旧 API、Worker、Scheduler；随后迁移，再启动 Worker/Scheduler 和 API/前端（`deploy/scripts/deploy-staging.sh:23-35`）。因此如果直接按脚本运行，旧应用可能在破坏性迁移期间继续读写，Scheduler 又会在最终验收前恢复写入。安全执行计划必须先补上一个经评审的“迁移前停写、验收后恢复写入”机制；不能把人工反应速度当门禁。

回滚边界：

- **迁移前**：只要数据库仍是 `0028`，可重启已验证旧 release 的旧镜像，再重做验收。
- **`0029` 已提交后**：不能只切 `current`，也不能默认把旧应用启动到新数据库。`0029` 删除旧列，downgrade 只重新添加空列，且明确无法猜测恢复旧值（`backend/alembic/versions/0029_manual_geo_independent_facts.py:150-205`）；项目默认不执行 Alembic downgrade（`docs/Hostdzire部署上线流程.md:123-131`）。
- **新数据库上的应用故障**：若新应用可安全前滚，优先保留现场并前滚修复。若必须回旧 release，先保持所有写入口和 Scheduler 停止，经负责人确认恢复点和数据取舍后，恢复迁移前完整备份，再启动与 `0028` 兼容的旧 release。迁移后的任何写入都会在整库恢复时丢失，所以维护窗口内必须维持停写。
- **Nginx 回滚**：站点模板和项目安全 snippet 必须回到同一已验证旧 release，`nginx -t` 通过后才 reload；HSTS 客户端缓存不能立即撤销（`docs/Hostdzire部署附录.md:428-438`）。
- `current` 只是最后验收记录，不是流量开关；固定 Compose 服务早在它更新前已被替换（`docs/Hostdzire部署上线流程.md:123-129`）。

### 5. 公网、缓存、安全头与 Playwright 登录后只读验收

#### 公网与主机

- 公共 DNS A 记录仍指向既有入口。
- `deploy/scripts/smoke.sh https://geo.962850.xyz` 的 `/api/health/live`、`/api/health/ready` 均成功；ready 中 PostgreSQL、Redis 均为 `ok`（`deploy/scripts/smoke.sh:1-7`、`docs/Hostdzire部署附录.md:314-324`）。
- 首页标题为 PartSignal；API 短暂切换可做有限重试，持续失败必须停止。
- `/object-storage/` 不得返回 `502`；`fake-oss` 必须同时连接 internal 与 edge 网络（`deploy/compose.staging.yaml:57-74`）。
- 最后只读复核容器状态、`nginx -t`、内存和根分区；不在验收阶段清理 release、镜像、备份或持久数据。

#### 缓存

- 从真实首页解析实际哈希 JS 资源，不硬编码旧 asset。
- `/assets/*`：`Cache-Control: public, max-age=31536000, immutable`，且有 `Vary: Accept-Encoding`。
- `/index.html` 与 SPA fallback：`Cache-Control: no-cache`。
- WOFF2 不得返回 `Content-Encoding: gzip`。
- 任一缓存头缺失、重复或漂移即停止（`docs/Hostdzire部署附录.md:326-352`）。

#### 安全头

在 `/`、`/index.html`、真实 `/assets/*` 三类响应逐项确认：

- `Content-Security-Policy`：`script-src` 仅 `'self'`，并含 `trusted-types dompurify; require-trusted-types-for 'script'`；
- `Strict-Transport-Security: max-age=31536000`；
- `Cross-Origin-Opener-Policy: same-origin`；
- `X-Frame-Options: DENY`；
- `X-Content-Type-Options: nosniff`；
- `Referrer-Policy: strict-origin-when-cross-origin`。

不得加入 `script-src 'unsafe-inline'`、`unsafe-eval` 或宽松 default policy；项目安全头唯一仓库权威是 `deploy/nginx/partsignal-security-headers.conf`（`docs/operations.md:12-17`）。

#### Playwright 登录后只读验收

- 使用项目 `playwright-cli`，只从本机通过真实公网域名、新建的临时浏览器会话执行；不在服务器/容器安装浏览器，不用 curl 代替渲染。
- 未登录打开站点，确认最终到 `/login`，标题和正文正常，无空白页、无限加载。
- 只把 `PARTSIGNAL_SEED_ADMIN_PASSWORD` 单个值送入自动化进程内存；不读取整个环境文件，不输出、不落临时文件、不保存 storage state。提交密码前不抓 DOM 快照或截图。
- 登录后只读访问工作台和 `/configuration/ai`，确认导航、页面、已有渠道列表和认证路由正常。
- 使用干净浏览器上下文检查登录前后控制台；应用级 `error/warning`、静态资源失败、认证失败、脚本失败或路由失败均阻断。
- 不创建业务数据、不修改配置、不触发危险动作。结束后退出登录、关闭页面/会话并清除进程内凭据引用。
- 浏览器能力不可用时记录“UI 未验证”并停止完整发布（`docs/Hostdzire部署附录.md:354-364`）。

### 6. 当前阻塞条件

1. 本地工作树 108 项脏改动，且本地 HEAD 与 `origin/main` 不一致；不满足发布来源门禁。
2. 5 个本地提交尚未成为已推送的 `origin/main` 权威版本；不能从它们制作正式 release。
3. Trellis `prd.md` 仍为 TBD，缺少复杂任务所需的 `design.md`、`implement.md` 和实施前评审。
4. `0029` 会删除现场真实非空 `recommendation_status/cited`，但尚无明确的数据丢失批准和验收条件。
5. `VERIFY_DATABASE_URL` 未配置，无法证明备份可恢复，也无法完成 `0028 -> 0030` 隔离彩排。
6. 尚无最终备份、gzip 完整性、哈希、隔离空库恢复、关键计数、异地加密副本和密钥成对保护证据。
7. 现有部署脚本未建立破坏性迁移所需的迁移前停写/验收后恢复边界；旧服务可能跨迁移运行，Scheduler 会在验收前启动。
8. 尚未证明旧 release 与 `0030` 数据库兼容；根据删除列事实，不应假定可做应用单独回滚。
9. 尚无 5 个待发布提交的定向测试、部署脚本检查、迁移测试和本地安全头检查结果。
10. 尚未确认本机 Playwright 验收能力及不泄露凭据的单变量注入方式；完整发布不能以 curl 替代。

## Files Found

- `.trellis/tasks/07-28-production-redeployment/prd.md` — 当前仅有目标，需求和验收标准仍为 TBD。
- `.trellis/tasks/07-28-production-redeployment/task.json` — 任务仍处于 planning。
- `.trellis/workflow.md` — 复杂任务规划、评审、激活和研究持久化门禁。
- `docs/Hostdzire部署上线流程.md` — Hostdzire 日常决策、停止条件、验收和回滚主 Runbook。
- `docs/Hostdzire部署附录.md` — 完整发布、备份恢复、Nginx、浏览器验收和回滚命令事实源。
- `docs/operations.md` — 跨环境数据、安全、备份、恢复和 E2E 原则。
- `deploy/scripts/deploy-staging.sh` — full/fast 执行顺序；当前未在迁移前停止旧应用。
- `deploy/scripts/backup.sh` — 权限受限的 PostgreSQL gzip dump；pipeline 失败证据不足。
- `deploy/scripts/restore-verify.sh` — 向指定 URL 恢复，并仅检查 `alembic_version`、`users`。
- `deploy/scripts/smoke.sh` — 公网/本机 live、ready 探针。
- `deploy/compose.staging.yaml` — staging 服务、网络、回环端口、健康和资源边界。
- `backend/alembic/versions/0029_manual_geo_independent_facts.py` — 删除旧逐篇累计事实列并重建 GEO 约束/触发器。
- `backend/alembic/versions/0030_publication_record_delete.py` — 在 `0029` 之后增加发布聚合受控删除门禁。
- `backend/app/services/integrity.py` — 当前 preflight 实际覆盖范围。

## Code Patterns

- 完整部署顺序为“构建 -> 依赖服务 -> preflight -> migrate -> Worker/Scheduler -> API/前端 -> seed -> 探针”（`deploy/scripts/deploy-staging.sh:23-43`）。
- staging PostgreSQL 与 Redis 只在 internal 网络，无宿主机发布端口（`deploy/compose.staging.yaml:24-55`）。
- API、对象存储、前端仅绑定宿主机回环端口（`deploy/compose.staging.yaml:57-74`、`deploy/compose.staging.yaml:81-100`、`deploy/compose.staging.yaml:126-140`）。
- `0029` 升级无条件 drop 两列；downgrade 只建空列，无法恢复旧值（`backend/alembic/versions/0029_manual_geo_independent_facts.py:20-41`、`backend/alembic/versions/0029_manual_geo_independent_facts.py:150-205`）。
- `0030` 只增加受事务变量约束的删除门禁，不提供数据恢复能力（`backend/alembic/versions/0030_publication_record_delete.py:11-58`）。

## External References

- 无外部资料。本次结论完全基于仓库事实源和调度上下文。
- 内部版本边界：Nginx `>=1.29.3`；Compose 使用 PostgreSQL `16-alpine`、Redis `7.4-alpine`（`docs/Hostdzire部署上线流程.md:38-39`、`deploy/compose.staging.yaml:25-26`、`deploy/compose.staging.yaml:41-43`）。

## Related Specs

- `.trellis/spec/backend/database-guidelines.md:341-407` — `0029` 的独立事实、历史保留、删除链和迁移测试契约。
- `.trellis/spec/backend/database-guidelines.md:350-365` — 当前 revision/字段签名及不保留推荐、引用累计事实的业务契约。
- `docs/operations.md:19-24` — PostgreSQL 单一状态源与有损迁移门禁。
- `docs/operations.md:46-54` — 备份、恢复、密钥配对和应用/Nginx 回滚边界。

## Caveats / Not Found

- 按 Trellis research 角色隔离规则，本次未读取 `implement.jsonl` 或 `check.jsonl`；它们是 implement/check 上下文清单，不是部署事实源。
- 未执行任何 Git 命令、远端写操作、远端状态复查、数据库查询或浏览器登录。
- 未读取、输出或持久化任何环境文件内容、密码、主密钥、私钥或其他凭据值。
- 现场提交、脏文件数量、远端 current/revision/健康和数据计数均来自调度上下文；正式执行前仍需按上述只读门禁重新核验。
- 文档把该目标定义为公网“预发布”且 Compose 项目为 `partsignal-staging`（`docs/Hostdzire部署上线流程.md:1-3`、`docs/Hostdzire部署上线流程.md:36-39`）。如果用户口中的“生产”指另一套环境，当前 Runbook 不构成对那套环境的部署授权。
