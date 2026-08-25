# Frontend V2 Phase 9 Staging Activation Recheck 设计

## 1. 设计结论

复用现有 `git archive`、Hostdzire release 目录、`deploy-staging.sh`、Compose `frontend` service、外层 Nginx、原生 Docker/Compose/PostgreSQL 命令和项目 `playwright-cli`。不新增发布脚本、自动回滚、第二套 Compose、兼容层或状态源。

执行流固定为：

```text
固定 candidate
→ 来源对齐门禁
→ candidate-aligned V1 artifact
→ fresh backup + preflight
→ full activation
→ 冻结 backend/V2 image ID 与 protected baseline
→ HTTP Gate
→ Browser Gate
→ 成功后更新 current 并判 MET
```

任一 Required 条件失败立即停止并判 `NOT_MET`；不自动进入 frontend-only fallback。

## 2. 身份与 artifact

固定提交为 `0e472399bc09a82ffba7e16ca4f245b01267d475`。release ID 在获批窗口按 Runbook 一次生成：

```sh
ps_candidate_commit=0e472399bc09a82ffba7e16ca4f245b01267d475
ps_candidate_release="mvp-$(date +%Y%m%d-%H%M%S)-0e472399bc09"
```

同一 release 必须产生并冻结：

| 角色 | 固定 image ref |
| --- | --- |
| candidate backend/fake-oss | `partsignal-backend:$ps_candidate_release` |
| candidate-aligned V1 UI | `partsignal-frontend-v1:$ps_candidate_release` |
| candidate V2 UI | `partsignal-frontend:$ps_candidate_release` |

tag 只用于命名；每个实际身份以 `docker image inspect ... '{{.Id}}'` 的 `sha256:` 值为准。

## 3. Activation 与状态变化

activation 只使用 candidate release 的 `deploy/`：

```sh
PARTSIGNAL_VERSION="$ps_candidate_release" ./scripts/deploy-staging.sh
```

该 full 流程预期：

- `postgres`、`redis` 持久容器继续运行；
- `fake-oss`、`api`、`worker`、`scheduler` 切为同一 candidate backend image；
- `frontend` 切为 candidate V2 image；
- DB 从 `0040_content_draft_management` 前进到 `0043_geo_platform_identity`；
- 新增本次 migrate one-off container 记录；
- Nginx target/checksum 不变，因为 candidate template/security snippet 与当前已验收 owner一致；
- `current` 在 HTTP/Browser Gate 全绿前保持旧值。

因此 activation 前后不是全量 `cmp`：按上述允许矩阵逐项核对。full activation 完成后建立新的 candidate protected baseline，供后续 frontend-only fallback/restore 做字节级 `cmp`。

## 4. Protected-state owner

candidate baseline 包含：

1. `postgres redis fake-oss api worker scheduler` 的 container ID、config image、image ID、state/health；
2. Compose project 中 `migrate` container 的 ID/image/status 排序集合；
3. `alembic_version`，必须为 `0043_geo_platform_identity`；
4. Nginx site target、site checksum、project security snippet checksum与 `nginx -t`；
5. `/root/partsignal/current`；
6. candidate backend、V1 UI、V2 UI 三个冻结 image ID。

快照不读取 container environment、数据库业务正文或凭据。V1 fallback 和 V2 restore 后分别重拍快照，与 candidate baseline 执行 `cmp`；只允许 frontend container/image 改变，因此 frontend 不写入 protected snapshot。

## 5. 精确 frontend-only 命令

V1 fallback：

```sh
PARTSIGNAL_FRONTEND_IMAGE="$ps_v1_repo" \
PARTSIGNAL_VERSION="$ps_candidate_release" \
docker compose --env-file ../.env.staging -f compose.staging.yaml \
  up -d --wait --wait-timeout 60 --no-deps --no-build --pull never \
  --force-recreate frontend
```

V2 restore：

```sh
PARTSIGNAL_FRONTEND_IMAGE="$ps_v2_repo" \
PARTSIGNAL_VERSION="$ps_candidate_release" \
docker compose --env-file ../.env.staging -f compose.staging.yaml \
  up -d --wait --wait-timeout 60 --no-deps --no-build --pull never \
  --force-recreate frontend
```

其中 `ps_v1_repo=partsignal-frontend-v1`、`ps_v2_repo=partsignal-frontend`。两条命令必须在 candidate release 的 `deploy/` 执行，并在执行前核对 target image ref、image ID、Compose flags 和 dry-run service scope。

## 6. 验收层次

HTTP Gate 先确认 artifact、路由、API、cache/source-map 和安全头，不通过时不创建浏览器 session。Browser Gate 再通过真实公网域名验证认证/session、代表业务读路径、四档布局、history 和运行时错误。浏览器只读，不创建或修改业务数据；登录凭据只在内存使用，不进入命令行、日志、截图、trace、video、storage state 或任务文档。

## 7. 失败边界

- candidate 不在 origin、release/image/backup 无法冻结、preflight/migration/deploy 失败：停止，不更新 `current`。
- HTTP/Browser Required 失败：`Staging Gate=NOT_MET`，保留现场，不自动 fallback。
- 只有用户针对精确 candidate release、V1/V2 image ID 和上述命令另行授权，才执行 frontend-only fallback；fallback 成功仍保持 Gate=`NOT_MET`。
- protected snapshot 变化或 V2 restore 失败：停止所有新操作，不启动历史 backend、不 downgrade、不 restore DB、不改 Nginx/current 掩盖失败。
