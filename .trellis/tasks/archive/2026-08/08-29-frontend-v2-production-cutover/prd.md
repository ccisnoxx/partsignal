# Production Cutover Gate

## 终止状态

- Outcome：`CANCELLED_BY_SCOPE_DECISION`
- Gate：`NOT_APPLICABLE`
- Execution：`NOT_STARTED`
- Remote mutation：`NONE`

本规划因开发阶段范围决策改变而终止。Production 数据转换、服务激活、Nginx 或流量切换均未执行，不能记为 `MET`；未操作 Hostdzire、Production 数据、镜像、release、quarantine 或环境文件。未来如需切换，必须重新规划。

## 目标

在获批维护窗口内，使用 Rehearsal 已证明的同一 candidate 和命令合同，把既有 `partsignal-staging` runtime identity 原地转换为 Production，完成真实 AI/OSS Gate、异步服务激活与受控公网流量切换，并保留可执行恢复路径。

## 要求

- 执行前重新冻结容器、端口、数据根/device/owner/mode/size、DB revision、镜像、manifest、Nginx enabled target/`nginx -T`/checksum、TLS 和公网基线；任一漂移即停止。
- 明确停止写入和维护窗口，停止旧七项服务后用固定锁和状态机隔离旧 postgres/redis/objects，不使用无状态 `mv`、删除或跨设备复制。
- Deploy 前验证本地候选镜像与 manifest；运行配置预检、migration、integrity、账号初始化，只启动 API/Frontend，并记录实际 DB revision。
- 真实 AI/OSS Gate 必须产生 candidate/run/manifest-bound 报告；只有批准人签发 `MET` 后才激活 Worker/Scheduler。
- Cutover 计划必须把新容器占用 `19000/19080` 视为可能的实际流量切换点，并按执行时 Nginx owner 定义原子授权顺序；Nginx 配置写、`nginx -t` 和 reload 分别受控。
- 回退保留失败 Production 数据和外部副作用证据；Frontend 只回滚到 manifest 冻结的上一份 V2，full restore 不自动 Alembic downgrade，也不把新 Production 写入合并回旧数据。

## 验收标准

- [ ] Production 状态达到 `PRODUCTION_INITIALIZED`，运行 candidate、manifest、实际 DB revision、容器和 Nginx identity 一致。
- [ ] 真实 AI/OSS Gate=`MET`，Worker/Scheduler 只在 Gate 后启动；Production 不运行或代理 fake-oss。
- [ ] 回环和公网 live/ready、Frontend V2、TLS、安全头、缓存、missing asset/map 和 `/object-storage/` 边界通过。
- [ ] 维护窗口、首次公网命中新服务时间、首次受控写、外部副作用和恢复决策均有证据。
- [ ] Open P0/P1/P2=`0/0/0`，Cutover Gate=`MET`；进入 Observation，但不执行退役或物理清理。

## 不在范围

V1/旧 staging/fake-oss/旧镜像/quarantine 的删除，以及未在 Cutover 授权包中的防火墙、DNS、TLS 或 HSTS 变更。
