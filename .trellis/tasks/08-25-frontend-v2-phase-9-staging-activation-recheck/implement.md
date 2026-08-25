# Frontend V2 Phase 9 Staging Activation Recheck 实施计划

## 状态

- [x] 固定 clean `main` candidate：`0e472399bc09a82ffba7e16ca4f245b01267d475`。
- [x] 创建已授权 Trellis Task 与唯一临时分支。
- [x] 完成 Hostdzire/public HTTP 只读 inventory。
- [x] 形成可 review 的 PRD、design、implement 与 evidence inventory。
- [x] 用户批准最新规划，Task 已进入 `in_progress`。
- [x] 用户单独授权非强制 push；固定 candidate 已存在于 origin，且 `main=origin/main=candidate`。
- [x] 用户精确授权 Phase B staging 写操作。
- [x] 完成 fixed release、V1 artifact、fresh backup、full activation 与 HTTP Gate。
- [x] 用户单独授权并执行 Browser Gate；匿名登录页出现 TrustedScript CSP error，按 fail-fast 停止并关闭专属 session。
- [x] Browser Gate=`NOT_MET`、open P0/P1/P2=`0/1/0`；`current` 不更新，Staging Gate=`NOT_MET`。

当前硬停止点：Browser Gate 已确认 P1 blocker；不得继续输入凭据、扩大浏览器矩阵、更新 `current` 或执行 fallback/restore。产品修复需要独立授权与后续 Task。

## 阶段 0：来源与授权门禁

```sh
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = 0e472399bc09a82ffba7e16ca4f245b01267d475
test "$(git rev-parse origin/main)" = 0e472399bc09a82ffba7e16ca4f245b01267d475
```

只有上述条件与用户对 staging 写操作的精确授权同时满足，才进入阶段 1。pull、push、merge、rebase 都不包含在本计划的自动动作中。

## 阶段 1：制作并上传固定 release

按 Runbook 附录 4.1–4.2 从 candidate 创建唯一 `git archive`、记录 SHA-256、检查敏感/AppleDouble/代理目录条目，上传到 Hostdzire 的唯一 incoming 路径，创建不可覆盖 release 并只链接既有 `/root/partsignal/shared/.env.staging`。

停止条件：归档不来自 candidate、release 目录已存在、环境文件缺失或权限不是 `0600`、归档含禁止条目。

## 阶段 2：迁移前 artifact 与 fresh backup

在任何 migration 前：

1. 从 `"$ps_release_dir/frontend"` 构建 `partsignal-frontend-v1:$ps_candidate_release`。
2. 冻结 V1 UI image ID。
3. 记录 activation 前 protected snapshot。
4. 从既有数据创建 fresh backup：

```sh
cd "$ps_release_dir/deploy"
set -a
. ../.env.staging
set +a
export PARTSIGNAL_VERSION="$ps_candidate_release"
export BACKUP_DIR=/root/partsignal/backups
export COMPOSE_FILE=compose.staging.yaml
ps_backup=$(./scripts/backup.sh)
test -s "$ps_backup"
```

5. 执行 full script 内置的 candidate `preflight-integrity`；任何非空结果停止。

## 阶段 3：完整 activation

精确入口：

```sh
cd "$ps_release_dir/deploy"
PARTSIGNAL_VERSION="$ps_candidate_release" ./scripts/deploy-staging.sh
```

禁止设置 `PARTSIGNAL_DEPLOY_MODE=fast`。完成后冻结：

- `partsignal-backend:$ps_candidate_release` image ID；
- `partsignal-frontend:$ps_candidate_release` image ID；
- candidate protected baseline；
- frontend V2 container image ID；
- DB revision=`0043_geo_platform_identity`；
- loopback live/ready/frontend；
- Nginx checksum 与 `current` 未变化。

## 阶段 4：HTTP Required Gate

按顺序验证：

1. `/api/health/live`、`/api/health/ready`、`/api/v1/auth/me`；
2. `/`、`/index.html`、`/login` 与代表 SPA deep links；
3. 标题 `PartSignal Frontend V2` 与真实 hashed JS/CSS；
4. missing asset=`404`、`${MAIN_JS}.map=404`、主 JS 无 `sourceMappingURL`；
5. HTML/client fallback=`no-cache`，hashed asset=`public, max-age=31536000, immutable` 与 `Vary: Accept-Encoding`；
6. CSP、HSTS、COOP、X-Frame-Options、nosniff、Referrer-Policy；
7. frontend container image ID、candidate release 与固定提交身份一致。

任一失败立即停止，记录 `Staging Gate=NOT_MET`，不创建 Playwright session，不自动 fallback。

## 阶段 5：Browser Required Gate

HTTP 全绿后读取项目 `playwright-cli` skill，使用唯一 session：

```text
frontend-v2-p9-staging-activation-recheck
```

矩阵：

| 类别 | Required |
| --- | --- |
| Auth | `/login`、登录、session restore、logout；若没有专用 must-change 账号，只记录该闭环未验证并判 Gate 未满足 |
| Workbench | `/` 只读加载与代表关注项链接 |
| Products | `/products` 与一个代表 detail/workspace deep link |
| Content | `/content/tasks` 与一个代表 detail/editor/review 只读页面 |
| Publishing | `/publishing/work` 与一个代表 workspace |
| GEO | `/geo/observations` 与代表 detail/insights |
| Configuration/System | `/settings/platforms`、ADMIN `/settings/ai`、`/system/users`、`/system/audit`；ENGINEER 代表权限拒绝 |
| Responsive | 375、768、1024、1440 代表布局无根溢出或不可达操作 |
| History | direct、refresh、Back、Forward 后 URL 与页面状态一致 |
| Runtime | console error、pageerror、非预期 requestfailed、CSP violation、失败 script/style/image/font 为零 |

结束前 logout、关闭该 session，并确认 Task session 不再 open；不得使用 `close-all`/`kill-all`。

实际结果：Chrome 通过真实公网域名首次加载匿名 `/login` 时，console 记录
`This document requires 'TrustedScript' assignment. The action has been blocked.`，来源为
`/assets/schemas-C9kTthWC.js`。匿名 `/api/v1/auth/me=204` 正常，故该错误不是认证失败噪声。
按 Required fail-fast 合同立即停止，未输入或使用 ADMIN/ENGINEER 凭据，未继续登录、路由、
响应式或 history 矩阵。专属 session 已关闭并确认不再 open；自动生成的 snapshot/console
临时文件已删除，未创建 screenshot、trace、video 或 storage state。Browser Gate=`NOT_MET`。

## 阶段 6：结论与 `current`

只有阶段 3–5 全绿且 open P0/P1/P2=`0/0/0`，才按 Runbook 原子更新 `current` 到 `releases/$ps_candidate_release`，复核 symlink 与实际 container/image 后判 `Staging Gate=MET`。

任一 Required 失败判 `NOT_MET`。fallback/restore 不在 activation 授权中；只有后续单独授权才执行 design 中的精确 frontend-only 命令与 protected snapshot `cmp`。

实际结论：Browser Gate=`NOT_MET`，open P0/P1/P2=`0/1/0`，因此 Staging Gate=`NOT_MET`。
V2 与 DB `0043_geo_platform_identity` 保持活动，`current` 保持
`releases/mvp-20260806-195740-afb1b8c82f40`；未执行 fallback/restore。

## Required Validation

规划阶段：

```sh
git diff --check
python3 -m json.tool .trellis/tasks/08-25-frontend-v2-phase-9-staging-activation-recheck/task.json >/dev/null
python3 ./.trellis/scripts/task.py validate frontend-v2-phase-9-staging-activation-recheck
```

外部阶段 Required 是阶段 0–6 的观察结果与 Gate matrix。P9.1 Repository Gate 已在 candidate 祖先提交通过，本 Task 不改产品、contract 或部署 owner，因此不重复 `make verify`。

## Optional Validation

- 无。真实 staging Gate 不能由本地测试替代。

## 提交边界

本轮只产生 Trellis planning/inventory 文件。提交前展示精确 commit plan 并等待确认；不自动 commit、push、merge、archive 或开始后续 Task。
