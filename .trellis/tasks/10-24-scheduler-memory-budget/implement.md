# Scheduler 资源修正与验证记录

## 本轮交付

2026-10-24：仓库 Scheduler 调整为 0.5 CPU / 256 MiB。实际应用差异只有 deploy/compose.prod.yaml 的两项参数；healthcheck、启动命令、重启策略及业务代码不变。docs/production-configuration.md 记录资源预算及验收边界。任务内保留隔离验收工具、24 小时计划和原始证据。

本轮没有连接或修改线上、重启线上、部署、写入线上业务数据、调用外部 AI、暂存、提交或推送。未覆盖旧 manifest，也未将本地结果转记为 GEO-1010-DEPLOY 通过。

## 短期对照结果

有效运行是 evidence/arm64-short-r3，摘要为其 summary.json。两组同一 backend runtime image，0.5 CPU，分别192/256 MiB，禁止swap，真实 beat、worker 与自然健康检查。新空PG数据库、独立Redis DB、internal网络、无端口和线上卷；AI/模型/业务任务表为空。配置与隔离证据见 runtime-isolation.json、midpoint-readonly-db.json 和 input-identity.json。

| 观察 | 192 MiB 基线 | 256 MiB 候选 |
| --- | --- | --- |
| 自然健康检查 | 首轮 exit137 | 20/20 成功 |
| OOM / 重启 | OOMKilled=true、exit137；实验禁止重启 | 均为0 |
| 持续窗口 | 首次OOM后停止 | 616.12秒 |
| 内存 | 退出前最后采样约191.3MiB，不作精确OOM峰值 | 内核 memory.peak 202.703125MiB；余量20.819% |
| 健康检查耗时 | 首轮失败 | 平均2.327秒，P95 3.614秒，最大5.260秒 |
| swap | 0 | 0 |
| 周期维护 | 退出后不续跑 | 六类分钟任务各成功10次，共60次，无错误日志 |

最终候选快照：scheduler_tick=21、scheduler_publish=60、worker_heartbeat=21；观察失败、pending/dispatch_due/expired/review backlog均为0。小时任务没有被此约10分钟窗口覆盖。

本机为 ARM64 Linux VM（cgroup v2），不是Hostdzire原生AMD64；代码/依赖也不等同于历史线上6a候选。本结果支持最小配置方案，不能证明线上35次OOM已永久解决或可直接部署。

## 执行命令与检查

```sh
colima start ps-scheduler-budget --cpu 2 --memory 4 --disk 20 --mount none --activate=false --ssh-config=false
docker --context colima-ps-scheduler-budget build --target runtime -t partsignal-scheduler-capacity:local backend
docker --context colima-ps-scheduler-budget pull postgres:16-alpine
docker --context colima-ps-scheduler-budget pull redis:7.4-alpine
python3 .trellis/tasks/10-24-scheduler-memory-budget/run-isolated-comparison.py --context colima-ps-scheduler-budget --image partsignal-scheduler-capacity:local --output .trellis/tasks/10-24-scheduler-memory-budget/evidence/arm64-short-r3 --checks 20
APP_ENV=test CONTENT_GENERATOR=deterministic uv run --project backend pytest backend/tests/unit/test_geo_ops_health.py -q
git diff --check -- deploy/compose.prod.yaml docs/production-configuration.md
```

- 容量对照退出0；定向运维健康单测8项通过。
- 对HEAD与当前Compose分别执行受控env的 `docker compose config --format json`，递归比较仅 scheduler.cpus 和 scheduler.mem_limit 不同；healthcheck一致。结果见 evidence/compose-diff.json。
- 验收工具语法检查通过；直接注入 FileNotFoundError/ProcessLookupError 两个proc退出分支通过，见 evidence/proc-exit-boundary.json。
- 独立只读复核发现两个测试工具P2：退出与采样竞态、创建后中断的清理登记顺序。已修复；实际信号测试又发现 InterruptedError 会被 communicate/select 作为EINTR重试，改用KeyboardInterrupt退出并清理。
- 未运行全量make verify、全量E2E、部署脚本全套、AI/OSS实际调用；本轮没有改变相应业务合同，无需据此扩大验证。

## 失败尝试的归属

- arm64-short：派生镜像FROM直接使用image ID导致构建失败，改为冻结ID对应的专用本地tag；不是容量有效样本。
- arm64-short-r2：观测容器cgroup namespace导致proc路径不可解析，改为只读观测容器使用宿主cgroup namespace；不是容量有效样本。资源精确清理已成功。
- harness-faults、harness-faults-r2、harness-faults-r3：SIGTERM注入没有按预期终止，断言失败；不计为故障验收通过。记录揭示上述InterruptedError处理缺口；各次资源均已清理。
- 正式容量r3运行时已固定应用镜像。随后测试工具的退出采样/清理修正未改变被测代码、配置或镜像；使用独立故障注入验证工具修正，不机械重复20轮容量检查。

## 后续验收

原生AMD64连续24小时：NOT_STARTED。执行命令、输入身份、停止/清理条件、责任人及判定详见 acceptance-plan.md；不创建后台计划或自动化。须覆盖小时任务、检查长期趋势和至少15%峰值余量，再记录24H_PASS。保持task in_progress，不归档，不替代部署授权。

## 最终复核与故障注入

```sh
python3 .trellis/tasks/10-24-scheduler-memory-budget/verify-harness-faults.py --context colima-ps-scheduler-budget --image partsignal-scheduler-capacity:local --output .trellis/tasks/10-24-scheduler-memory-budget/evidence/harness-faults-r4
```

r4 两项 PASS：创建成功后 SIGTERM 令驱动非零退出，complete=false，PG/网络/临时tag清理均0；inspect后、cgroup读取前强制终止基线，基线exit137但OOMKilled=false，候选继续成功，所有资源清理均0。原始事件、结果、堆栈及summary均保留，未将人为kill当作容量OOM。driver hash与当前文件一致。

独立 critical_reviewer 复核代码及r3/r4原始证据，确认先前P2解除、没有新的实质缺陷；没有运行测试或修改文件。最终语法检查、diff空白检查通过；暂存区为空，原有工作区修改保留。

清理复核见 evidence/cleanup.json：专用Engine容器和卷均为空，网络仅剩bridge/host/none；Docker当前context仍为default，默认Colima保持Stopped。本轮创建的容器、数据库、Redis数据、派生tag和临时目录/pycache已清理。专用VM执行 `colima stop --profile ps-scheduler-budget` 停止；停止状态另见cleanup.json。

保留的非源码产物：本任务evidence约960KiB用于验收追溯；专用Colima profile `/Users/sc/.colima/ps-scheduler-budget` 及磁盘 `/Users/sc/.colima/_lima/_disks/colima-ps-scheduler-budget` 仅保留可复用基础镜像/构建缓存，所有者为本任务，无业务数据。无需继续复现时可明确删除该独占profile；未清理用户default或共享缓存。未留下24小时作业或其他本轮后台业务进程。

## 原生AMD64环境后续核对

2026-10-24 用户授权满足条件即可启动。完成本机、Colima和dmit/hostdzire/cox/pub只读现场核对，四个远端均可连接但无合格独立环境；未执行24小时命令，状态保持NOT_STARTED。准确结果及缺少条件见environment-readiness.md，结构化证据见evidence/amd64-environment-inventory.json。没有远程写入或新进程，无本轮临时资源需要清理。

用户明确要求保留未关闭状态：task.status=in_progress，meta.execution_state=WAITING_INDEPENDENT_AMD64_ENVIRONMENT；24h=NOT_STARTED，短测ARM64_SHORT_PASS及原始证据完整保留。

## 2026-10-25 用户修订：现有线上Docker最小变更方案

用户要求取消独立AMD64测试机前置，仅制定Scheduler内存到256 MiB的最小变更、观察和回退方案，不操作线上、不提交推送。已形成[当前方案](online-memory-change-plan.md)，旧acceptance-plan/environment-readiness标为历史，ARM64短测和原始证据保留。

方案选择唯一现有Scheduler动态更新，不重启、不重建或另启Beat；RAM提高64 MiB，Docker MemorySwap按现场有效swap额度计算，避免顺带缩小swap额度。CPU/镜像/命令/健康检查及其他服务保持。观察分即时、15～30分钟自然检查、跨维护周期和建议约24小时回看，不新增自动跟进或独立连续试验门禁。256 MiB下仍OOM不能默认降回已知有故障的192 MiB；参数回退需要明确选择与现场条件，应急停止/恢复单列授权。

同步当前任务状态、输入清单和暂停恢复入口；任务仍in_progress，执行状态PLAN_READY_WAITING_ONLINE_CHANGE_AUTHORIZATION，线上变更与观察NOT_STARTED。本轮只读本地现有文件和历史脱敏结果、核对Docker/内核官方文档并编辑方案；未连接Hostdzire、执行任何docker命令、运行应用测试或重复容量检查，未修改生产配置、启动进程、暂存、提交或推送。未修改deploy/compose.prod.yaml或既有验收工具。

独立critical_reviewer只读复核发现1项P2：原MemorySwap=0时回退直接传0不能保证恢复原swap额度。已将原始字段与规范化回退执行总额分开，使用原RAM+有效swap额度（无swap等于原RAM，原无限为-1）；独立复核确认该问题解除，其余指定范围未确认material问题。该结论只针对方案文本，不代表线上或实际回退已验证。

本地方案检查：任务JSON可解析，新增相对链接16处有效，10份本轮文档/记录文本空白检查及git diff --check通过；228份其他工作区文件、现有Compose/验收脚本、HEAD和暂存区摘要未变。实际线上基线、资源更新、自然观察及回退仍未执行。
