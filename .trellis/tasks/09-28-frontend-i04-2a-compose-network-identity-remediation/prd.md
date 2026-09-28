# I04-2A Production Compose network identity 修复

## 目标与授权

修复 `deploy/compose.prod.yaml` 的 logical network key，使其与 Hostdzire 现存 `com.docker.compose.network` label 精确相等，在现有 deploy harness 内证明真实 Docker Engine 兼容性，并在最终 clean pushed main 重建唯一 `make verify` Repository Release Gate。父任务为 `09-27-frontend-i04-2-release-freeze-clean-init-cutover`。

## 固定合同

- 基线 commit `8651ca1ef4620285301ae3c5e9b474bbe6014ff2`，tree `f5fbb3630bc5f6e3c83551c361e587abba979ae3`；candidate/local main/origin/main 相等，两树 clean。
- project 固定 `partsignal-staging`；logical key 与 physical name 均为 `partsignal-staging-internal`、`partsignal-staging-egress`、`partsignal-staging-edge`。
- internal 保持 `internal: true`；migrate/API/worker/scheduler 只连接 internal+egress；PostgreSQL/Redis 只连接 internal；frontend 只连接 edge。Production 无 fake-oss、19001 或 `/object-storage/`。
- 不改变 dev/staging 运行语义、应用代码、schema/migration、权限、Production env 或 AI bootstrap/clean-init 状态机。
- 本地回归先证明旧 logical key 对已存在正确 label 的真实 Engine 失败；修复后证明所有 service 复用正确 label，三种错误旧 label 均显式拒绝。不得跳过 Engine、sleep 或使用模糊错误白名单。
- Hostdzire 只读；不 relabel/recreate 当前网络，不使用 external/override/其他 project/docker run 绕行，不停止容器、改 Nginx/env、进入维护或执行 cutover。
- 旧 release `mvp-20260928-023635-649641cec3bd` / run `prr_20260928_023635` / archive/images/manifest 为不可覆盖历史失败证据，不复用、删除、retag 或修改。

## 验收

- [ ] 静态精确断言 logical/name/每个 service network/internal/安全拓扑，Production 无旧 key。
- [ ] 本地真实 Engine 正向复用和旧 label 负向覆盖通过，自己创建的 network/container/temp 全部清理。
- [ ] deploy local 先校验 manifest image identity；local run/up 均 `--pull never`；rollback 保持 `--no-deps --no-build --pull never`，三条路径使用同一 Production Compose。
- [ ] manifest/release 绑定的 runbook preflight 显式 `--pull never --no-deps`，清楚区分 physical name 和 logical label。
- [ ] 定向 Compose、deploy cleanup/production/staging、Nginx、syntax、diff、secret scan 全部通过并保存日志、exit/count/bytes/SHA-256。
- [ ] 第一次 fresh 只读 critical review 为 `NO BLOCKER`，随后 commit/fast-forward/non-force push 且两树 clean。
- [ ] 最终 clean pushed main 上 `make verify` 只运行一次且通过，受控资源归零；失败归因并建立准确 blocker 后停止。
- [ ] 冻结代码后第二次 fresh 只读 high-risk review 为 `NO BLOCKER`；记录真实 Gate/日志/警告/下一步。
- [ ] I04-2A completed；I04-2 in_progress/network_identity_remediated；I04 和总体任务 in_progress；不生成 release/manifest 或进入 cutover。

## 留给下一会话

真实 AI provider 非 secret metadata 和 credential owner true-TTY handoff 尚缺；旧 AI channel/model/header counts=0 是历史只读证据，本任务不解决或伪造。下一会话先满足这两项，再使用新 commit/release ID/run ID/archive/image tags/manifest 冻结全新 release。
