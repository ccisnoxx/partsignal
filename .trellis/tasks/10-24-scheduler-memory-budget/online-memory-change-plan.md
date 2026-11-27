# Scheduler 256 MiB：现有线上 Docker 最小变更、观察与回退方案

日期：2026-10-25。状态：**PLAN_ONLY_NOT_EXECUTED**。用户只授权制定方案，不操作线上、不提交推送。本方案替代“必须先具备独立原生AMD64测试机及完成隔离24小时试验”的前置要求；原短测、环境调查和旧试验方案作为历史保留。

## 1. 目标与最小范围

未来另获执行授权后，仅对hostdzire现有PartSignal Scheduler容器，将RAM硬上限从192 MiB提高至256 MiB，同时保持原有可用swap额度。优先使用Docker动态资源更新，不重建、不重启容器，不新增第二个Beat或Worker，不启动隔离对照栈。

CPU保留已接受的0.5核；镜像、命令、健康检查（30秒/15秒）、restart policy、环境、挂载、数据库与Redis连接均保持。若现场CPU等基线与原记录不一致，先报告差异，不顺便修正。RAM上限增加64 MiB不等于立即分配64 MiB，也不等于无需检查宿主资源压力。

复用ARM64短测（256 MiB完成20轮自然健康检查，192 MiB组OOM）、既有Compose差异检查和定向测试；不重跑这些检查，不将其写成线上已通过。线上稳定性以未来实际观察为准。当前不购置机器、不创建新Engine或Docker context、不构建/拉取镜像、不改应用或部署脚本。

## 2. 执行前的一次只读基线

这些步骤尚未执行。实施时从hostdzire按项目/service标签定位唯一Scheduler，历史名称partsignal-staging-scheduler-1仅作线索；使用当次核实的完整容器ID，不能只按名称或旧current软链接写入。

保存脱敏、明确字段的基线：

- 完整容器ID、image ID、Compose工作目录、project/service标签、PID、StartedAt、RestartCount、State和Health；同时记录现有API/Worker/PG/Redis的身份与健康作保护对照。
- Docker Engine/kernel/cgroup版本；HostConfig的Memory、MemorySwap、MemoryReservation及CPU参数；容器PID对应cgroup的memory.max、memory.current、memory.peak、memory.events、memory.swap.max/current与cpu.max。
- 宿主MemAvailable、swap使用和内存压力、现有OOM事实。确认当前无宿主级内存故障，能够容纳本次64 MiB上限增量；不能用10-24的瞬时可用内存替代执行时判断。
- 观察5～10分钟自然健康检查及内存变化，保存既有故障基线和变更时刻。容器已在退出/重启循环、身份不唯一或资源配置无法解释时，先处理/报告现状，不把新旧故障混作变更结果。
- 通过现有PostgreSQL客户端执行短只读事务读取geo_operation_health中scheduler_tick、scheduler_publish、worker_heartbeat的成功/失败计数及时间；不导出正文、凭据或完整配置。

资源值为192 MiB时才进入本次提高上限步骤；已经是256 MiB则不重复更新，记录“未执行变更”，按后续明确范围观察；其他值先报告。核实唯一目标和实际资源值不能由历史记录代替。

只导出字段白名单；完整docker inspect及环境变量不得进入证据。观察从宿主/cgroup和Docker状态读取，不在Scheduler容器内额外执行Python health/snapshot，不手动触发健康检查或业务任务。

## 3. 保持swap额度的一次资源更新

Docker的MemorySwap表示RAM＋swap总额，cgroup v2的memory.swap.max表示独立swap额度。两者不能混同。以执行时已生效的独立swap上限S计算：

| 现有swap额度 | 256 MiB后的Docker参数 | 保留内容 |
| --- | --- | --- |
| 有限S字节 | Memory=268435456；MemorySwap=268435456+S | 独立swap额度仍为S |
| 不允许swap（S=0） | Memory=268435456；MemorySwap=268435456 | 继续无swap |
| 无上限，且现场已确认对应Docker -1 | Memory=268435456；MemorySwap=-1 | 保留原有无限swap策略，不新增此策略 |

例如原来192 MiB RAM＋192 MiB swap，Docker总额为384 MiB；调整后应为256 MiB RAM＋192 MiB swap，总额448 MiB。盲目保留384 MiB总额会把swap额度缩到128 MiB。原MemorySwap为0/未设置时，不能将它解释成0 swap或无限；先核对有效cgroup与Engine行为，无法确认则暂不执行。

变更前分别保存原始MemorySwap字段与**规范化的回退执行值**：原RAM为M0、有效swap额度为有限S时，回退总额为M0+S；S=0时等于M0；已确认原无限swap时为-1。PS_SCHEDULER_SWAP_TOTAL_BEFORE必须采用这个规范化值，不能直接使用原始0/未设置，因为Docker将0视为未设置。例：原RAM192/S192且原字段0时，回退执行总额为384 MiB；回退裁决恢复原有效RAM/S，原始字段仍留档，不要求将HostConfig字面恢复为0。

在已核实的容器ID与计算结果填入当次shell变量后，未来执行命令形态为：

```sh
docker update --memory 268435456 \
  --memory-swap "$PS_SCHEDULER_SWAP_TOTAL_AFTER" \
  "$PS_SCHEDULER_CONTAINER_ID"
```

变量无默认值；不source生产.env，不使用Compose up/restart，不附加--cpus、--restart等其他参数。Docker字段虽可能调整Memory与MemorySwap两项，生效语义只增加RAM上限并保持swap额度。

命令返回后立即重读Docker资源配置与有效cgroup，确认RAM=256 MiB、独立swap上限未变、CPU未变、容器ID/image/PID/StartedAt及其他配置未变。API返回非零也必须重读实际值，避免部分生效后盲重试；不能将命令成功代替生效验证。若发生意外重启，保留事实并停止正常验收，不补写“无重启”。

## 4. 观察安排与分阶段结论

| 阶段 | 最小观察 | 可记录的结论 |
| --- | --- | --- |
| 即时 | 更新后确认有效资源和身份、健康及其他服务保护字段 | APPLIED_RESOURCE_VERIFIED；只证明资源变更生效 |
| 当场15～30分钟 | 宿主侧约每5秒读取cgroup，约每60秒读取Docker Health/RestartCount；按健康检查Start时间去重，取得至少20次变更后的自然健康检查 | 无新增OOM/重启、检查全成功、tick/publish/worker心跳正常才记SHORT_OBSERVATION_PASS |
| 跨自然维护周期 | 下一轮小时级维护任务自然到期后，核对已有日志/运维计数与分钟任务，无新增失败或持续积压 | PERIODIC_OBSERVATION_PASS；尚未到期或无结果则明确待观察，不手动触发清理/恢复任务 |
| 建议约24小时后回看 | 复用既有运维记录、同一容器的OOM/重启增量、内存/swap趋势及自然维护结果 | 有多少历史证据就报告多少；不是另建环境的连续24小时实验，也不新增自动跟进 |

观测字段以变更前后增量判断：memory.events的oom/oom_kill、RestartCount、健康退出码/耗时、memory.current/peak、swap.current、cpu.stat、宿主压力、三类运维计数和已有积压。历史OOM/RestartCount不清零；memory.peak是cgroup生命周期峰值，不重置，不把旧峰值声称为新窗口峰值。Docker Health只保留有限条目，短窗口要及时采集；24小时缺少逐次检查历史时，不宣称全程每次健康检查通过。

数据侧只用固定短只读查询，例如：

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SELECT operation, success_count, failure_count, last_success_at, last_failure_at
FROM geo_operation_health
WHERE operation IN ('scheduler_tick', 'scheduler_publish', 'worker_heartbeat');
ROLLBACK;
```

既有周期任务继续其正常行为；观察本身不创建/补发任务、不启动AI或OSS探针，也不承诺生产数据在正常运行期间零变化。只保留脱敏的计数、错误码和任务名，不导出业务正文或完整Celery载荷。

256 MiB的85%（217.6 MiB）保留为容量提醒，不作为超过即回退的硬门槛。结合是否持续接近上限、swap增长、压力及健康结果判断；不自动升到更大规格。任务后续完成需要实际资源生效、短窗口与自然维护周期结果及明确工作接受；24小时回看是补充运维观察，不再作为独立试验硬门禁。

不添加cron、Codex自动化或无人值守写入循环；当场观察为有限前台会话，后续回看在明确的人工操作窗口进行。没有后续输入时不自行唤醒或反复查询。

## 5. 停止条件、回退与失败处理

出现新增OOM/重启、自然健康检查失败、身份/配置漂移、宿主级内存故障或调度/Worker新增持续故障时，停止宣布通过并保存现场；停止观察会话不等于停止Scheduler。先辨别原有故障、本次变更和正常业务波动，不反复更新资源、重启或放宽健康检查。

**256 MiB下仍OOM时，自动降回192 MiB通常会恢复已知故障条件，因此不把它作为默认止损。** 保留256 MiB实际状态与失败证据，报告方案不足；不自动改成512 MiB、关健康检查或停用其他服务。

只有确认需撤销本次资源修改、明确接受恢复原故障基线的风险时，才采用参数回退：

1. 重新确认同一完整容器ID和当前状态，读取当次保存的原Memory、原有效swap额度及规范化回退总额；不使用文档中的旧容器ID，也不直接将原始MemorySwap=0作为回退参数。
2. 先看当前memory.current与正在进行的健康检查。当前用量达到/超过原RAM上限时，不在线强降。即使用量暂低于192 MiB，随后探针分配仍可能OOM，不能把这一步当作无风险保证。
3. 条件允许且操作者明确选择参数回退后，使用原资源值执行一次docker update，并重新核实有效cgroup、CPU、身份与健康；失败时只读核实是否部分恢复，不循环重试。

```sh
docker update --memory "$PS_SCHEDULER_MEMORY_BEFORE" \
  --memory-swap "$PS_SCHEDULER_SWAP_TOTAL_BEFORE" \
  "$PS_SCHEDULER_CONTAINER_ID"
```

不能安全在线降低、或出现宿主/服务严重故障时，转入人工应急处置。必要的单Scheduler停止/恢复需在未来执行窗口中明确授权；当前方案不自动执行docker stop/start/restart。停止Scheduler会暂停周期派发/清理与恢复调度，不能作为无影响动作；恢复时避免第二Beat并行。无此操作授权时，保留当前限额、告知故障和运维联系人，不强制回退，不停止其他服务。

## 6. 配置持久性与记录

动态更新不会同步修改Compose或重新冻结release。当前仓库已存在0.5 CPU/256 MiB的未提交配置；不为本次计划提交推送，不修改旧release的Compose、manifest、哈希、env、软链接或部署状态来掩盖差异。

未来实施后记录精确目标、原/新Docker值及有效cgroup、swap计算、时间、执行者、命令结果、观察和异常、当前配置来源与回退选择。将其列为受控运行时资源差异；后续重建/部署前由发布负责人核对，正常新候选应纳入256 MiB。容器被旧Compose重建时可能恢复192 MiB，不能把一次动态更新宣称为所有未来重建都已持久化。

本次不触发完整make verify、镜像构建、数据库迁移、全量E2E、部署脚本套件或业务smoke。源代码与既有验证输入未改变，复用已完成证据。当前只检查方案、文档链接/一致性及差异，线上变更与观察均NOT_STARTED，任务继续in_progress。

## 7. 依据与恢复入口

- [短测与实现记录](implement.md)、[短测原始摘要](evidence/arm64-short-r3/summary.json)。
- [旧隔离试验方案](acceptance-plan.md)、[旧环境调查](environment-readiness.md)只作历史，不再阻断本方案。
- [Docker动态更新](https://docs.docker.com/reference/cli/docker/container/update/)、[Docker内存与swap含义](https://docs.docker.com/engine/containers/resource_constraints/)、[Linux cgroup v2内存限制](https://docs.kernel.org/admin-guide/cgroup-v2.html)。降低硬上限可能触发回收或OOM，回退条件据此保留。

后续需要明确的执行范围是“针对唯一现有Scheduler的一次资源更新、有限只读观察及可行时的参数回退”；是否包含应急单容器停止/恢复须单列。本次用户只要求方案，以上动作均未获本轮执行授权。
