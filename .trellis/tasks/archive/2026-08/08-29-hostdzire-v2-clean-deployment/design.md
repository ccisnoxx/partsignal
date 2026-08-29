# Hostdzire V2 Clean Deployment Design

## Status

Reviewable planning design。用户确认前不实施，不运行 `task.py start`。仓库合同修正、非停机 artifact preparation、原地 data cutover、Nginx 切换和 Observation 共享同一 release/manifest/run ID，必须顺序执行，不拆成可并行 child task。

## Invariants

1. release source 唯一：fixed clean `origin/main` commit。
2. runtime frontend 唯一：canonical `frontend/` 构建的 `partsignal-frontend:<release-id>`；V1 永不进入 manifest、Compose 或 rollback。
3. business state 唯一：新 PostgreSQL；Redis 只作 Celery broker。
4. old state 可恢复但不可混用：旧 `postgres/redis/objects` 只在 quarantine，Production 不 mount quarantine。
5. secret owner 唯一：`/root/partsignal/shared/.env.production`；证据只包含 location/mode/configured status。
6. state owner 唯一：`prepare-production-data.py` cutover state；不得手改 JSON 或建立第二状态文件。
7. traffic owner 唯一：活动 Nginx target；site replacement 和 reload 分离授权。
8. failure remains explicit：不使用 V1、fake OSS、deterministic provider、宽松安全开关或静默 fallback 掩盖失败。

## Target Topology

```text
DMIT L4 proxy_protocol
        |
Hostdzire Nginx 10.0.0.2:80/443
        |-- /api/* -> 127.0.0.1:19000 -> api
        `-- /*     -> 127.0.0.1:19080 -> canonical frontend

partsignal-staging Compose project (historical identifier)
  postgres <- /root/partsignal-data/postgres
  redis    <- /root/partsignal-data/redis
  migrate  (one-shot)
  api + frontend
  worker + scheduler (production-async only)

No fake-oss, no 19001, no /object-storage/ proxy
```

## Phase A: Repository Contract Correction

Production `deploy.sh` always pulls images, but this deployment rebuilds them on Hostdzire and has no approved registry owner。Manual Compose would duplicate and weaken manifest/state ownership。

Add one explicit image-delivery mode at the current owner：

- default `registry`：preserve pull → verify order；
- `local`：do not pull；require candidate images already present；verify manifest image ID/RepoDigest before any create/run/up；pass `--pull never` to relevant `docker compose run/up` in deploy and activate；
- rollback remains `--pull never` and manifest-bound；
- reject unknown mode and V1 repository；
- no wrapper、plugin、registry、new Compose or second deploy script。

Expected owners：`deploy/scripts/deploy.sh`、`activate-production.sh`、`test-deploy-production.sh`、Hostdzire Runbook/附录。Implementation exact-code read may select a smaller established owner but cannot broaden behavior beyond this requirement。

## Phase B: Candidate Freeze and Host Build

1. After planning approval and Trellis activation，make contract correction reviewable，validate，present commit plan and obtain confirmation。
2. Candidate cannot freeze until clean `main` is synchronized to `origin/main` by the user or separate authorization，fresh fetch proves equality，and status is empty。
3. Define immutable `release-id = ps-<Beijing timestamp>-<12-char commit>` and record full commit。
4. Artifact Gate creates absent targets only：clean Git checkout `/root/partsignal/releases/<release-id>`，sibling source archive/manifest，and local backend/frontend images。
5. Build sequentially。Before each build require available memory ≥2 GiB and root free ≥10 GiB；otherwise stop without maintenance。
6. Run frontend container artifact checks and Production deployment tests before manifest freeze。
7. Freeze current active V2 `partsignal-frontend:mvp-20260825-172239-2a6fd940b848` / `sha256:72b206...` as rollback target；V1 is a hard reject。
8. Generate manifest from the Hostdzire clean checkout。Test escape hatches are forbidden。

If Hostdzire cannot access authoritative origin，stop before maintenance。A different source transport needs a new evidence design；no guessed archive fallback is included。

## Phase C: Configuration Gate

`/root/partsignal/shared/.env.production` is currently absent。It is provisioned server-side without displaying values，as non-symlink `root:root 0600`。The user/operations owner provides Production-only secrets through a secure channel；the agent validates metadata and uses the existing status-only preflight。

Required evidence：exact metadata、Production Compose `config --quiet`、status-only preflight JSON、no secret/URL/bucket/password output。Configuration failure stops before maintenance and leaves current Staging runtime untouched。

## Phase D: Maintenance and Data Cutover

At maintenance start，rerun inventory and compare exact container/image/Compose/data/Nginx/env/capacity facts。Any drift changes the authorization package。

Stop only the seven enumerated services without `down` or orphan removal。Confirm all targets stopped，ports `19000/19001/19080` free，no active data mount，state/run absent，and three leaves ordinary/same-device with numeric owner/mode/size recorded。

Run `quarantine <run-id>`。Expected state：

```text
/root/partsignal-data-quarantine/<run-id>/postgres
/root/partsignal-data-quarantine/<run-id>/redis
/root/partsignal-data-quarantine/<run-id>/objects
/root/partsignal-data/postgres  # new empty
/root/partsignal-data/redis     # new empty
/root/partsignal-data/.partsignal-production-cutover.json
phase=QUARANTINED
```

No physical delete。A failure uses the same run ID only when state/path evidence proves script-defined continuation；otherwise preserve evidence and restore/review，never manual rename。

## Phase E: Clean Init and External Gate

Run fixed release `deploy.sh` with local image mode，Production env，manifest，data root，`clean-init` and same run ID。

Expected sequence：candidate/state binding；local image verify without pull；PostgreSQL/Redis healthy；config preflight；migration；actual revision equals manifest schema head；integrity `[]`；account initialization；API/frontend ready；state `PRODUCTION_PREPARED` while async/fake-oss remain stopped。

Then run release-bound real AI/OSS checks。Only current-candidate `MET` permits activation。Activation uses same identities/local mode and must reach `PRODUCTION_INITIALIZED` with Worker/Scheduler healthy。

## Phase F: Nginx Cutover

Remote security snippet already matches repository，so it is not a write target。

1. `cp -a` exact current site target to `.pre-<run-id>` backup。
2. Render fixed release template with address `10.0.0.2` into same-directory temporary ordinary file。
3. Verify root ownership、`0644`、only `19000/19080`，no `19001`/`object-storage`/static root，and checksum。
4. Atomically replace `/etc/nginx/sites-available/partsignal-staging.conf`；enabled symlink remains。
5. Run `nginx -t`。
6. Present separate reload authorization with old/new/backup checksums；only then reload。
7. Run loopback/public/browser acceptance。

If test fails，restore backup and test again，without reload。If post-reload acceptance fails，restore backup，test，and separately authorize recovery reload。

## Validation and Observation

Repository required：local-image-mode targeted tests、Nginx security checker、staging/Production deploy tests、backend CLI unit、frontend container artifact、`git diff --check`。

Remote required：config/capacity/source/image/manifest gates；DB/Redis/API/frontend/async health；actual migration revision；account login/change-password；live/ready/routes/redirects/permissions/representative read-write；cache/map/CSP/security/no object-storage；AI/OSS success and explicit failure；secret-safe logs。

Initial Observation starts after public acceptance。Deployment may succeed while cleanup remains deferred；success never implies permanent cleanup。

## Recovery Matrix

| Failure point | Recovery |
| --- | --- |
| Contract/build/manifest/env before stop | Stop；current runtime unchanged |
| After stop，before quarantine complete | Same run only if state proves continuation；otherwise preserve and restore old services |
| After quarantine，before prepared | Stop new writes/services；`restore <run-id>`；preserve failed-production；restart exact old 7-service runtime |
| Prepared external Gate failure | Keep async stopped；retry within budget or data restore；no Nginx change |
| Async activation failure | Stop new async；preserve state/logs；restore if not resolved within window |
| Nginx test failure before reload | Restore site backup；test；running Nginx remains old config |
| Public failure after reload | Restore backup，test，authorize recovery reload；restore application/data if needed |
| Frontend-only defect | Manifest-bound frontend-only recreate to current verified V2；no V1/DB/API/Nginx change |

`/root/partsignal/current` is an acceptance record，not rollback switch。It may be atomically updated after Observation under authorization，but task success does not depend on it。

## Downtime and Stop Policy

- Artifact/config preparation is non-disruptive。
- Full UI/API outage and paused background jobs begin when the seven old containers stop。
- 60-minute hard window：T+20 without `PRODUCTION_PREPARED` starts restore；T+45 without external Gate/Nginx cutover starts restore；T+60 must be verified new or verified restored old runtime。
- Data rename is small and same-device，but no exact duration is promised until live timings exist。

## Deferred Destructive Cleanup

No cleanup command is part of this design。A later task may propose exact IDs/paths for old data、V1/fake-oss images、releases、build cache or env files；it requires new destructive approval and cannot infer ownership from names alone。
