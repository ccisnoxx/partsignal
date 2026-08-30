# Hostdzire V2-only Production 远端执行设计

## 状态

本设计已获用户批准，`task.py start` 已运行，任务进入仓库实施准备。启动任务不授权任何远端写入；仓库维护隔离合同完成并验证后，候选冻结与六次独立远端授权仍必须按顺序推进，不能并行。

## 核心不变量

1. 源码 owner：固定且干净的 `origin/main` commit。
2. 前端 owner：canonical `frontend/`；V1 永不进入 manifest、runtime 或 rollback。
3. 工件身份：一个不可复用 release ID 绑定 source archive、manifest、backend/frontend、previous verified V2 frontend 与 Nginx templates。
4. 业务状态：新 PostgreSQL 是唯一业务状态；Redis 只作 Celery broker；旧三叶只存在于 quarantine/recovery。
5. secret owner：`/root/partsignal/shared/.env.production`；证据只有 metadata、固定枚举和 `*_configured`。
6. 数据状态 owner：`prepare-production-data.py`；禁止手改 state 或手工 rename。
7. 公网维护 owner：PartSignal Nginx site maintenance template；新 runtime 未完成 Gate 前不接受公网业务请求。
8. 流量 owner：活动 PartSignal site target；每次 write 与每次 reload 分离授权。
9. 证据 owner：本任务当次 manifest/run/inventory；历史 Gate 不继承。
10. 失败必须显式：不使用 V1、fake-oss、development storage、fixed-success provider、宽松安全配置、silent fallback 或永久删除掩盖失败。

## 当前与目标拓扑

```text
当前状态
DMIT L4 -> Hostdzire Nginx
  /api/*          -> 127.0.0.1:19000 -> staging api
  /object-storage -> 127.0.0.1:19001 -> fake-oss
  /*              -> 127.0.0.1:19080 -> canonical V2 frontend

执行维护阶段
DMIT L4 -> Hostdzire Nginx -> PartSignal maintenance response
  no application/storage upstream
  loopback 19000/19080 remains available only for local Gate probes

目标 Production
DMIT L4 -> Hostdzire Nginx
  /api/* -> 127.0.0.1:19000 -> Production api
  /*     -> 127.0.0.1:19080 -> canonical V2 frontend
  no 19001, no /object-storage/

partsignal-staging Compose project（历史标识符）
  postgres <- /root/partsignal-data/postgres
  redis    <- /root/partsignal-data/redis
  migrate  one-shot
  api + frontend
  worker + scheduler via production-async profile
  no fake-oss, no objects mount
```

## 为什么必须建立 Nginx 维护配置 owner

既有计划把最终 Nginx 替换当作流量切换，但新旧运行时绑定相同的 loopback 端口。`deploy.sh` 会在外部 Gate 前启动新 API/frontend，当前 Nginx 会立即代理到新容器。健康检查不能阻止已认证用户或自动化在这个间隔向新数据库写入。

最小正确设计是一个站点级维护模板：

- 提交在 `deploy/nginx/` 下，并纳入 manifest tracked files；
- 保留 `geo.962850.xyz`、`10.0.0.2` render token、TLS/ACME/security includes 和 `add_header_inherit merge`；
- 不包含 upstream、proxy_pass、static root、`19000/19001/19080` 或 object-storage owner；
- HTTPS 业务路径返回确定性的维护状态；
- 只修改 PartSignal site target，不修改全局 Nginx、DMIT、DNS、TLS 或其他站点。

这会在同一个硬窗口内增加两次 Nginx 转换：original → maintenance，再由 maintenance → Production。每次写入都必须原子执行并通过测试；每次 reload 都独立授权。恢复可能需要第三次独立授权的转换。

## 执行状态流

```text
PLANNING
  -> repository maintenance-guard contract validated
  -> candidate frozen and Artifact/Configuration approved
  -> artifacts/env ready; old runtime unchanged
  -> maintenance site written (N1)
  -> maintenance reload approved (N2), T0 starts
  -> exact old containers stopped
  -> QUARANTINING -> QUARANTINED
  -> CLEAN_INIT_DEPLOYING -> PRODUCTION_PREPARED
  -> real AI/OSS Gate for same manifest
  -> PRODUCTION_INITIALIZED
  -> final Production site written (N3)
  -> final reload approved (N4)
  -> public/browser acceptance -> Observation

quarantine 后发生任何失败
  -> preserve evidence and stop new services
  -> RESTORING -> RESTORED
  -> exact old 7-service runtime restored under maintenance site
  -> original Nginx target restored and recovery reload separately approved
  -> verified old runtime; no second attempt in same window
```

## 阶段 A：仓库合同与候选边界

### 维护模板变更

预期仓库 owner：

- 新增 `deploy/nginx/partsignal-maintenance.conf.template`；
- 更新 `create-release-manifest.py` 和 `prepare-production-data.py` 的 tracked allowlist；
- 为 `test-deploy-production.sh` 增加无 upstream/proxy/storage/static root 的负向断言，以及 TLS/security/maintenance status 的正向断言；
- 只在 tracked allowlist 或 operation contract 发生变化的位置更新 Hostdzire Runbook、附录和 Production image-delivery spec。

不引入新的 deploy wrapper、Compose project、service、network、registry、firewall 或通用 Nginx framework。

### 候选冻结

只有在获批的仓库变更经单独 commit 确认提交到 `main` 并同步到 `origin/main` 后，才能冻结候选。Release identity 使用届时的完整 commit；本轮规划不虚构最终 release/run ID。

Host checkout 必须从权威 origin 获取该 commit。不接受缺少 `.git` 的纯源码副本、未验证 archive fallback 或 `PARTSIGNAL_ALLOW_UNVERIFIED_RELEASE_SOURCE_FOR_TESTS=1`。

## 阶段 B：工件与配置

Package A 不造成服务中断，只创建当前不存在的对象。由于当前可用内存仅约 2.14 GiB 且没有 swap，backend/frontend 必须顺序构建。每次构建前都要检查容量；根盘可用空间必须保持至少 10 GiB。

Manifest 生成时绑定：

- 完整 commit/release/schema head；
- source archive name/SHA-256；
- backend/current frontend/rollback V2 reference、full image ID、全部 RepoDigest；
- Production/maintenance Nginx template 和全部 tracked deploy files。

Manifest 生成后，package 独立复算 archive/manifest/tracked checksums，并执行 frontend container artifact 和 deploy-script 验证。不修改任何旧 image/tag/release。

Production env 由用户或运维 owner 在服务器侧 provision。执行任何 Compose 命令前，package 检查 exact path、regular/non-symlink、numeric owner/group 和 `0600`；status-only preflight 必须在不输出值的前提下显示 Production enums 和全部必需 `*_configured=true`。

## 阶段 C：Nginx 维护转换

原始活动 target 备份到包含 run ID 的排他字面量路径。固定候选维护模板渲染到同目录临时文件，并检查：

- exact candidate checksum；
- `root:root 0644` 且位于同一 device；
- 不包含 upstream/proxy/static root/application/storage ports；
- TLS、ACME、security snippet owner 未变化。

Target 原子替换后运行 `nginx -t`。这次写入不授权 reload。若 reload 未获批准，则在已批准的写入边界内恢复 original target 并再次测试；维护窗口不开始。

N2 独立获批后，只执行一次 `systemctl reload nginx`。公网维护响应成立且 application upstream 不再可访问时，建立 T0。

## 阶段 D：精确停机与 Quarantine

T0 后立即重读 7 个 full ID、project/service label、image/state/restart/OOM/health、mount、listener、data metadata、state、env metadata 和 capacity。任何漂移都会使 Package M 失效。

停机顺序先移除生产者，再停止状态存储：scheduler → worker → api → frontend → fake-oss → postgres → redis。容器只停止、不删除。必须验证全部目标已停止、app/storage 端口已释放，并且没有运行中容器挂载 active/quarantine/failed-production 路径。

从 fixed release 执行 `quarantine <run-id>`，预期结果：

```text
/root/partsignal-data-quarantine/<run-id>/postgres
/root/partsignal-data-quarantine/<run-id>/redis
/root/partsignal-data-quarantine/<run-id>/objects
/root/partsignal-data/postgres  # empty
/root/partsignal-data/redis     # empty
/root/partsignal-data/.partsignal-production-cutover.json
phase=QUARANTINED
```

不重建 `objects`。仅当脚本状态证明仍是完全相同的 run 时，才允许从中断点继续；否则保留现场并恢复或重新评审。

## 阶段 E：Clean-init 与 Prepared 校验

使用同一 release、manifest、run、env 和 data root，以 local/clean-init mode 运行 `deploy.sh`。脚本负责 candidate binding、PostgreSQL/Redis、Production config preflight、migration、integrity、account initialization、API/frontend 和 prepared state。

维护站点持续阻断公网流量，同时由 local probe 执行脚本尚未强制的附加控制：

- API/frontend/PostgreSQL/Redis container 的实际 image identity 等于 manifest/fixed base identity；
- candidate tag 未移动；
- source archive 和 manifest checksum 保持固定；
- `alembic_version` 等于 manifest `schema_head`；
- integrity 结果为空，seed account 存在且不披露密码；
- API/frontend live/ready，Worker/Scheduler/fake-oss stopped；
- state 精确等于 `PRODUCTION_PREPARED`。

任何不一致都进入恢复，不能降级为 warning。

## 阶段 F：真实外部 Gate 与激活

真实 AI 验证通过 Production 网络策略使用已配置的真实 OpenAI-compatible channel，只记录安全的 ID/status/timing。验证包含一次成功请求和一个预期的显式失败边界，不关闭 TLS validation 或 retry control。

真实 OSS 验证覆盖 canonical pre-sign、upload、backend HEAD、short download，以及来自目标 browser origin 的 CORS。它还必须证明 Production 不存在 fake-oss service/mount/proxy，也没有静默复用旧 object reference。

脱敏证据记录绑定当前 manifest SHA-256。只有完成该绑定后，单次 activate invocation 才能接收 `PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET`。激活后必须验证 `PRODUCTION_INITIALIZED`、Worker/Scheduler healthy、API/frontend identity 未变化，并且 fake-oss stopped/retained。

## 阶段 G：最终 Nginx 转换与验收

先备份 maintenance target。以 `10.0.0.2` 渲染固定候选 Production template，校验 candidate checksum 与 directive allowlist 后原子安装并测试。N4 获批前，运行中的 Nginx 仍保持维护状态。

N4 获批并执行一次 `systemctl reload nginx` 后，执行：

- loopback/public live/ready 和 route smoke；
- Production artifact cache/map/source-marker 检查；
- security headers/CSP 和 `/object-storage/` no-owner 检查；
- login、must-change、canonical pages、legacy redirects、direct/refresh/history、permission refusal、revision conflict；
- 通过公网表面执行一组受控的代表性读写，并核验真实 AI/OSS 结果。

`/root/partsignal/current` 是验收记录，不是流量或 rollback switch。部署成功不要求更新它；如果后续需要更新，必须取得自身的 exact write authorization。

## 观察期

公网验收后开始 Observation，并在 T+60 决策点前持续。它记录 Nginx 5xx/upstream、API errors、container restart/OOM、async queues/workers/scheduler、DB/Redis health、AI/OSS 和核心业务结果。只有存在本候选的证据时，Gate 才能标记 `MET`；延后清理不影响部署成功判定。

## 恢复矩阵

| 失败点 | 恢复动作 |
| --- | --- |
| N2 前的 repository/artifact/env 失败 | 停止；旧 runtime 和运行中 Nginx 保持不变 |
| N1 测试失败 | 恢复 original target，运行 `nginx -t`，不 reload |
| N2 reload 失败 | 恢复 original target 并测试；只有运行配置可能变化时才申请 recovery reload |
| T0 后、quarantine 前失败 | 验证旧 7-service runtime 后恢复 original site，并独立授权 reload |
| Quarantine/clean-init/prepared 失败 | 停止新服务、保留证据、执行 `restore <run-id>`，在维护站点下恢复 exact 旧 7-service runtime |
| 真实 AI/OSS 或 activation 失败 | 保持公网维护、停止新 async，并在窗口内恢复 data/application |
| N3 测试失败 | 恢复 maintenance target 并测试，不 reload；继续维护或恢复数据 |
| N4 后公网失败 | 恢复 maintenance target 并测试，独立授权 recovery reload，再决定 app/data restore |
| 成功后的 frontend-only defect | 只允许 manifest 绑定的 previous verified V2 frontend，不允许 V1，并重新验证公网合同 |

Recovery 默认不运行 Alembic downgrade，也不删除 failed-production、quarantine、candidate artifacts、old runtime artifacts 或 logs。状态进入 `RESTORED` 后，本轮尝试结束。

## 时间与授权模型

```text
T0 前：完成 repository + artifact/config，不产生 outage
T+00：maintenance reload 已验证
T+10：旧 services 已停止并安全进入 quarantine
T+20：达到 PRODUCTION_PREPARED，否则 restore
T+35：完成真实 external Gate + activation，否则 restore
T+45：final Nginx transition 已准备，否则 restore
T+60：已验证 Production，或已验证恢复的旧 runtime
```

Exact package schema 与当前 baseline value 记录在 `research/authorization-packages.md`。每次 reload invocation 都要独立批准；先前的 Nginx reload 批准不能复用于 final 或 recovery reload。

## 延后的破坏性清理

本设计不包含任何 cleanup command。后续任务可以 inventory 并提出 quarantine、failed-production、old env/images/releases/manifests/backups/fake-oss/build cache 的 exact ID/path；该任务需要新的 destructive authorization，不能只凭名称或时间推断 owner。
