# Scheduler 内存预算修复与隔离对照验收

当前范围（2026-10-25用户修订）：后续基于现有线上Docker，制定唯一Scheduler提高到256 MiB的[最小变更、观察和回退方案](online-memory-change-plan.md)。独立AMD64测试机及隔离24小时试验不再是前提；本轮只做方案，不操作线上、不提交推送。下方10-24隔离实现与验收作为已完成阶段历史保留。

## 目标与授权

仓库 Production Scheduler 调整为 0.5 CPU / 256 MiB；在隔离环境对照 192 / 256 MiB，完成定向验证并安排 24 小时持续验收。禁止修改线上配置、重启线上服务、部署、写入线上业务数据、调用外部 AI、提交或推送。

## 依据

2026-10-24 只读调查确认：Hostdzire 同一 Scheduler 容器 35 次内存 cgroup OOM，均在 192 MiB 上限下由 Python 健康检查分配触发，杀死 beat。健康检查进程约 104 MiB RSS；不能把进程 RSS 简单相加视为 cgroup 用量。10 月 23 日启用主机 swap 后，beat 约 67 MiB 已换出。CPU 0.25→0.5 的在线调整与随后 Compose 持久化均有用户授权；该改动解决探针超时，不能证明 OOM 已修复。

历史证据：`/Users/sc/Documents/Codex/2026-10-23/qi/outputs/partsignal-scheduler-cpu05-result.json`、`partsignal-scheduler-compose-cpu05-result.json`。旧 release manifest 保留原始身份，不覆盖哈希。

## 实现边界

- 业务修改仅 `deploy/compose.prod.yaml` Scheduler 的 `mem_limit` 与 `cpus` 两项。
- 新测试环境使用独立本地 Docker context、内网、容器和空数据库；不加载工作区 `.env`，使用虚构凭据，不发布端口，不使用线上卷或 Docker socket。
- 两组固定同一 backend image ID，CPU=0.5，内存分别为 192/256 MiB，memory-swap 等于 memory；真实 beat、worker、健康检查与原有周期均保留。
- ARM64 本地结果只证明本机表现；Hostdzire AMD64 的 24 小时持续验收另记待执行，不能用短期或跨架构证据关闭。

## 验收

- [x] Compose 有效差异仅 Scheduler 两项资源参数。
- [x] 隔离、无 swap、镜像身份和配置一致性有实际证据。
- [x] 候选完成至少 20 轮自然健康检查；基线完成20轮或首次OOM终止并保留。记录内存峰值、OOM/重启、检查耗时、心跳/发布和积压。
- [x] 256 MiB 的短期结果满足无 OOM、无重启、健康检查成功；失败则报告而不擅自扩大线上操作。
- [x] 明确原生 AMD64 24 小时命令、指标、停止条件、清理责任及状态。
- [x] 独立只读复核；精确清理本轮临时环境，保留验收证据。

## 状态

仓库配置和 ARM64 短期对照完成；详见 implement.md。原生 AMD64 24 小时持续验收 NOT_STARTED，执行状态 WAITING_INDEPENDENT_AMD64_ENVIRONMENT（等待独立 AMD64 环境）；task 保持 in_progress，不关闭。不得标为 OOM 已彻底修复或可部署。

2026-10-24 后续：已核对现有原生AMD64环境，均不符合隔离/运行前置条件，未启动24小时验收；详见 environment-readiness.md。用户的条件式启动授权已记录，无需重复审批现有范围。

## 2026-10-25 当前验收安排

- [x] 已提出基于现有Scheduler的动态RAM更新方案，保持CPU、有效swap额度、镜像、进程、健康检查与其他服务。
- [x] 已明确现场一次基线、即时生效核对、15～30分钟自然检查与跨维护周期观察、建议后续回看，以及有条件回退和应急授权边界。
- [ ] 获得本方案对应的线上执行范围；旧隔离试验授权不扩展为线上写入、停止或重启授权。
- [ ] 实际变更与短窗口、自然维护周期结果有证据，并经明确工作接受；目前均NOT_STARTED。

任务保持in_progress，执行状态改为PLAN_READY_WAITING_ONLINE_CHANGE_AUTHORIZATION。不运行旧对照工具或新建测试机，不把方案完成当作256 MiB已线上生效、长期稳定或GEO-1010-DEPLOY完成。
