# Frontend V2 P9 外部 Staging Gate 设计

## 1. 设计结论

复用现有 Hostdzire release、Compose `frontend` service、outer Nginx、完整发布脚本、V1 release 回滚和 `playwright-cli`。不写新 publisher、自动 rollback、credential manager 或环境抽象。

执行是一个带暂停点的单向流程：

```text
固定本地 candidate
  → A 只读身份/拓扑/DB/V1 inventory
  → Git 来源同步（独立授权）
  → B full runbook 激活，current 暂不更新
  → HTTP core gate
  → C 单 session 浏览器验收
  → 成功：按 B 的条件授权更新 current → Staging Gate=MET
  → 失败：停止并报告；仅在失败后另获 D 授权时恢复 V1 → Staging Gate=NOT_MET
```

任何阶段的新事实改变 owner、production 边界、数据库兼容性或回滚路径时，返回规划，不现场补兼容逻辑。

## 2. 权限边界

### A — 只读盘点

只允许：

- 本地 Git/SSH alias 解析；
- `ssh hostdzire` 执行不写文件、不创建容器、不重启服务、不迁移、不 reload 的命令；
- 公网匿名 `curl`/headers 检查；
- 当前运行容器内的只读 SQL、`alembic current/heads` 和 `preflight-integrity`。

不允许 `docker compose run`，因为它会创建临时容器；只对现有容器使用 `exec -T`。不读取或输出完整 `.env.staging`、container inspect、HTTP auth body/header、数据库业务正文或 credential。

### Git 来源同步 — 独立授权

Runbook 要求 clean/pushed/origin-main aligned。A 不包含 push。只有用户后续明确授权，才把固定候选同步到 `origin/main`；同步后仍必须证明 `HEAD=origin/main=candidate`。若远端已有不同提交，停止，不 merge/rebase/reset。

### B — 完整 staging 激活

授权范围是：制作固定 candidate archive、上传一个不可覆盖 release、链接既有共享 env、创建备份、执行 full deploy、运行 core smoke，并在 C 全绿后条件更新 `current`。不包含 Nginx 配置写入/reload，因为候选没有修改 outer template/snippet；A 若发现 drift 或首次安装需求，停止并另行规划。

### C — 浏览器验收

只使用公网域名和 session `frontend-v2-p9-staging-activation-validation`。除登录、logout、CSRF 读取及明确批准的专用 must-change account 一次改密外，不发送 mutation；不创建、编辑、审批、发布或删除业务数据/配置。

### D — 条件回滚

针对 A 冻结的唯一 V1 release 单独授权。只有命中明确 trigger、存在已确认安全的精确命令且用户在失败后另行授权，才重启该 release 的固定 Compose 栈并复验；B 失败不自动执行 D。不 downgrade DB、不改 DNS/Nginx、不删除新旧 release/image/backup/data。

## 3. A 的身份与拓扑判定

### 3.1 Staging identity=`CONFIRMED`

必须同时满足：

1. `ssh hostdzire` host key 正常，hostname/root identity 与既有运维目标一致；任何冲突立即停止。
2. 共享文件仅通过 allowlist 行确认 `APP_ENV=staging`、`APP_BASE_URL=https://geo.962850.xyz`、`CORS_ALLOWED_ORIGINS=https://geo.962850.xyz`，权限为 `0600`。
3. `current` 指向 `/root/partsignal/releases/mvp-...`，Compose project 为 `partsignal-staging`，服务/端口为 staging 固定值，并存在 `fake-oss`。
4. 生效 PartSignal site 的 `server_name`、loopback upstream、project security snippet 与仓库期望一致，`nginx -t` 通过。
5. 公网 live/ready/homepage、remote IP、headers 与 Hostdzire 服务时间窗一致；没有 production hostname、production compose 或真实 OSS/production credential 标记。
6. DMIT 入口至少能由 public remote IP 与本地 `dmit` alias 关联。若 alias 关联或转发 owner仍不明确，要求额外只读 `ssh dmit` 授权后才算 confirmed。

任一项不满足时 identity=`UNCONFIRMED`，B 禁止。

### 3.2 Current release identity

- 从 `current` basename 取得 release ID 和 12 位 commit suffix；在本地仓库唯一解析为完整 commit并证明其为 candidate 祖先。
- 记录 release tree regular-files checksum、Compose SHA-256、frontend container tag、Docker image ID、服务状态。
- 容器 tag、Compose project、current release 三者不一致视为 drift。

## 4. V1 rollback target 判定

唯一 target 默认是 B 前 `current`，但只有以下全部满足才冻结：

1. release 名称合法、目录存在、source checksum 已记录；
2. 该 release 自身的 Compose 精确包含 `context: ../frontend`，不含 `../frontend-v2`；
3. 活动 frontend container tag 归属该 release，Docker image ID 存在；
4. loopback/public V1 homepage、live、ready 均成功；
5. 当前 DB revision 下该 V1 正在健康运行，或 pending migration 静态审计证明升级后仍兼容；
6. 回滚命令使用该旧 release 自身 Compose 与 tag，已通过 `config --quiet` 只读解析；
7. D 已针对该精确 release 预授权。

若当前已是 V2、image 缺失、release 不是 candidate 祖先、DB compatibility 不清或只能在新 release 中临时改 context，则没有 rollback target，B 禁止。

A observed：artifact 层面的唯一上一 V1 为 `mvp-20260806-195740-afb1b8c82f40`，tag/image/source 均存在；但候选 `0043` 会为 `publication_works` 增加 insert trigger，旧 backend 不提供必需的 `platform_profile_id_snapshot`。因此该 release 不满足第 5 条，不能冻结为迁移后的整栈 rollback target，B 依本设计禁止。

## 5. 数据库、migration 与 backup

- candidate Alembic head 为仓库当前唯一 head；A 读取远程 `alembic_version` 并比较 current/candidate migration directories。
- 当前 revision已等于 candidate head：full deploy 的 migrate 预期 no-op，但仍由脚本执行；B 前创建 fresh non-empty backup。
- 存在 pending migration：列出每个 revision并检查 DDL/data rewrite、upgrade guard 与旧 V1 compatibility。任何 destructive/potentially incompatible migration 需要隔离 `restore-verify` 和明确旧 release compatibility，缺一则停止。
- `preflight-integrity` 必须由 candidate backend 实现执行。A 只能运行当前实现作基线；B 在新 release build 后按脚本再次执行 candidate implementation。
- `seed-demo` 是幂等认证数据写入。B 授权必须知晓该副作用；如果 A 发现共享 env 的 seed 前置不安全或会创建未批准账号，停止。
- 不执行 Alembic downgrade。回滚只允许在 V1 与已迁移 DB 兼容时进行。

A observed：远程 current=`0040_content_draft_management`，candidate head=`0043_geo_platform_identity`。执行日 fresh backup 尚不存在；现有 backup 目录权限与容量满足创建前置，但不能替代 B 前 fresh backup。`0043` 与旧 V1 backend 写合同不兼容，故当前不能进入 B。

## 6. 发布与 `current` 所有权

- release ID：`mvp-<yyyyMMdd-HHmmss>-<candidate-short12>`，不可覆盖。
- archive：只由 `git archive candidate` 生成；记录 SHA-256并检查 secret/AppleDouble/agent/Trellis 路径。
- shared env：只链接既有 `/root/partsignal/shared/.env.staging`，不下载、不打印、不生成。
- deploy：只运行 `PARTSIGNAL_VERSION="$RELEASE_ID" ./scripts/deploy-staging.sh` 默认 full；明确禁止 fast script/mode。
- outer Nginx：本候选不写、不 reload；仅 `nginx -t` 和只读 checksum。A 若证明目标配置不一致，停止。
- `current`：B deploy 后暂时仍指向 V1。只有 HTTP+C 全绿，才使用 Runbook 原子 link/move 记录 V2；该写动作是 B 授权中的条件尾声。

## 7. HTTP 验收矩阵

| 类别 | 检查 | 通过条件 |
| --- | --- | --- |
| 健康 | `/api/health/live`、`/api/health/ready` | 2xx；ready 中 PostgreSQL/Redis 正常；无连续 5xx。 |
| 同源 Auth | `/api/v1/auth/me`、页面实际 API | 匿名合同状态正确；浏览器 API origin 与页面 origin 相同。 |
| HTML | `/`、`/index.html`、`/login`、代表 client deep link | `200`、V2 title/root、`Cache-Control: no-cache`、安全头完整。 |
| assets | HTML 中全部实际 `/assets/*.js|css`、按导航加载的 lazy chunks | `200`、hash 路径、正确 content type、`public, max-age=31536000, immutable`、`Vary: Accept-Encoding`。 |
| fallback | 代表 Product/Content/Publishing/GEO/Settings/System deep link | 返回 V2 index 且 `no-cache`；不是 Nginx 404/空白。 |
| missing asset | `/assets/partsignal-p9-missing.js` | 精确 `404`，body 不是 `index.html`。 |
| source map | `<actual-js>.map`、artifact JS 内容 | map `404`；无 `sourceMappingURL`；浏览器无 `.map` 请求。 |
| security | `/`、`/index.html`、actual asset、deep link | CSP/Trusted Types、HSTS、COOP、DENY、nosniff、referrer policy 与 cache 共存且不重复漂移。 |
| compression | JS/CSS/WOFF2 | 压缩/`Vary` 符合 Runbook；WOFF2 不错误 gzip。 |

## 8. 浏览器验收矩阵

| 身份/表面 | 路径与动作 | 断言 |
| --- | --- | --- |
| 匿名 | `/login`、direct `/products`、`/system/users` | 登录页渲染；保护路由 replace 到 `/login`；无白屏/loop。当前合同不要求 return-to。 |
| ADMIN | 登录→`/` | Workbench/App Shell/导航/账户菜单正常；同源 session/CSRF/API 成功。 |
| 列表 | `/products`、`/content/tasks`、`/publishing/work`、`/geo/observations` | direct、refresh、Back、Forward；标题/表格或真实空态；无失败资源。 |
| Workspace/Detail | 从列表读取代表性现有 link，再 direct 打开 Product/Facts、Content Task、Publication Work、GEO Observation | ID 保持，refresh 可恢复，返回列表/history 正确；不执行写动作。无数据时记录 `BLOCKED`，不伪造 ID。 |
| Settings | `/settings/platforms` 与代表 Platform workspace | ADMIN/ENGINEER 按现有 server contract可读；direct/refresh/history 正常。 |
| ADMIN surfaces | `/settings/ai`、`/settings/prompts`、`/system/users`、`/system/audit` | ADMIN 页面可读；只打开列表/详情，不 mutation。 |
| ENGINEER | direct 上述 admin paths；选择一个只读 admin API GET | URL 保留、聚焦 403；API 返回 403/`PERMISSION_DENIED`；不靠隐藏按钮判定。 |
| must-change | 专用账号登录→`/account/security`→一次改密→`/` | redirect、说明、提交、服务端 session refresh 与最终 Workbench通过；只有明确 C auth-write 授权才执行。 |
| history | 每组代表路径 | direct、reload、go-back、go-forward 无重复重定向、身份丢失或错误焦点。 |
| runtime | 全过程 | console error/pageerror/requestfailed/CSP violation/失败 script-style-image-font=0；预期 204 abort 仅按已证实 pathname 分类。 |
| lazy chunks | 跨 Product/Content/Publishing/GEO/Admin 导航 | 新增 route chunk 请求为同源 hashed asset且 200；refresh 后仍成功。 |

只使用一个 session，角色间通过 logout 顺序切换；不保存 storage state。若角色切换需要并行 context，则停止并重新规划，因为用户固定了唯一 session 名。

## 9. Credential 注入

推荐最小安全方案：

1. 用户在仓库外创建一个权限 `0600` 的专用 credential 文件，路径由用户批准，内容只含本轮 staging 的 ADMIN、ENGINEER、must-change 账号和密码；不得在对话提供内容。
2. C 前只用 `test -f`、`stat -c %a` 验证存在/权限，不 `cat`、`grep`、`env`、`set -x` 或 hash 内容。
3. 一个无秘密的临时 `playwright-cli run-code --filename=...` helper 在 Node 内存读取文件、填充并提交；CLI argv 只出现 helper/path，不出现 credential。
4. helper 登录失败时先清空 password input 和内存字段；成功后才返回，让 CLI 自动 snapshot 落在已离开密码页的页面。
5. 全程 trace/video/screenshot/state-save 关闭；不检查 auth request body/header，不输出 cookie/localStorage。
6. 任务不删除用户提供的 credential 文件；由用户自行安全撤销/删除。session logout/close 是本任务责任。

如果用户不批准该方式或没有满足三种身份的账号，C 停止并请求安全提供，不从 remote `.env.staging` 读取值替代。

## 10. 失败停止与 D 触发

### 立即停止，不自动继续

- host-key 冲突、identity/commit/current/image/owner 漂移；
- candidate 未同步或 remote branch 不等于 candidate；
- V1 target/checksum/image/DB compatibility 任一缺失；
- backup、preflight、migration、build、Compose、Nginx test 任一失败；
- 需要 production、DNS、DMIT 写入、outer Nginx 写入或 schema/permission 产品变更；
- credential 注入不安全或 C session 无法清理。

### 命中 D 的条件

- B 激活失败但已替换任一固定服务；
- core live/ready/homepage 或 loopback smoke 失败；
- API base/session/login/permission 错误；
- CSP/Trusted Types、lazy chunk、asset、SPA fallback、cache/source map 阻断；
- 关键页面连续两次失败、5xx、不可恢复资源错误或浏览器运行时错误。

D 不修代码、不调配置。B 失败后先停止并报告；只有用户另行授权 D，才恢复 V1 并记录 V2 failure evidence。如果 D 本身失败，停止并报告现场，不扩大为数据库或 Nginx 恢复。

## 11. Gate 与文档 owner

### `MET`

固定 candidate 对应的 V2 release 保持活动；A identity/rollback、B full deploy、HTTP+C matrix 全绿；`current` 已记录 V2；无 open P0/P1/P2 blocker；V1 source/image/release 仍可用；文档与 task evidence 一致。

### `NOT_MET`

任一 Required 项失败/未运行、事实或 credential 不完整、触发 D、V2 未保持活动、`current` 未完成或 V1 基线损坏。D 成功后的状态是“staging 已恢复 V1，V2 Gate NOT_MET”。

### 文档更新

- 必改：task `research/audit.md`、`prd.md`/`design.md`/`implement.md`/`task.json`；`docs/frontend-v2/07-migration-plan.md`、`08-testing-quality-and-acceptance.md` 写实际 Gate 与 evidence。
- 条件改：`docs/Hostdzire部署上线流程.md`、`Hostdzire部署附录.md` 仅在观察事实证明现行 Runbook stale 时修改。
- 不改：产品、backend、contracts、database docs、permission docs、production docs；本任务不改变其权威合同。
