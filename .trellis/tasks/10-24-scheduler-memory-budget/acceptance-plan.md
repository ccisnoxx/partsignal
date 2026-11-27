# 历史：独立环境24小时持续验收安排

2026-10-25用户已改为基于现有线上Docker制定最小资源变更、观察和回退方案。本文件保留原隔离试验的历史条件与命令，不再作为当前硬性前置，不执行其中命令。当前恢复入口为[线上最小变更方案](online-memory-change-plan.md)；本轮仅规划，没有线上执行授权。

## 当前边界与状态

仓库资源修正、ARM64 本地短期对照和验证工具已完成。2026-10-24 用户进一步授权：现有环境具备条件即可启动24小时验收。本轮已核对本地及四个已配置SSH目标，没有符合条件的原生AMD64隔离环境，执行状态为 `WAITING_INDEPENDENT_AMD64_ENVIRONMENT`（等待独立 AMD64 环境），持续验收状态仍为 `NOT_STARTED`，未留下容器、后台采样或自动调度。缺少条件及实时证据见 [环境核对](environment-readiness.md)。执行负责人为取得合格环境后继续本任务的操作者。

线上仍须保持不变。后续本地/隔离容量通过也不构成部署授权，不允许覆盖旧 release manifest 来消除 CPU 手工调整的历史差异。

## 环境与输入

- 在原生 Linux AMD64、cgroup v2 的专用空 Docker Engine 执行；不能使用 Hostdzire 生产 Docker Engine、转发线上 Docker socket 或任何线上卷。
- 使用与待交付候选一致的源码、Dockerfile、uv.lock 和 backend 镜像，保留源码摘要、image ID、CPU架构、内核、Docker版本。不能用 ARM64 或 QEMU 结果代替原生 AMD64。
- 预先构建 runtime 镜像，拉取 PostgreSQL 16 Alpine、Redis 7.4 Alpine，并保存实际 image ID；实验运行期间只使用本地镜像。
- 脚本要求专用 context 名称以 `ps-scheduler-` 开头、endpoint 为本机 Unix socket，并拒绝已有容器的 Engine。该检查不证明 socket 的业务归属，执行者必须先确认它确属独立测试环境。
- 每组使用新建空数据库和独立 Redis logical DB；网络 internal=true，无映射端口、无 Docker socket、无宿主工作目录挂载。只有观测容器只读挂载该测试 Engine 宿主的 `/proc` 与 `/sys/fs/cgroup`。
- 使用 production Settings 与虚构凭据，OSS endpoint 指向容器回环的不可用端口；无 AI渠道/模型/业务任务。实际 beat、worker、PG、Redis、健康检查和既有 6 类分钟任务、2 类小时任务保持。此验收验证容量及空载周期维护，不声称真实业务吞吐或 AI/OSS 验收。
- 两组均 0.5 核，内存分别 192/256 MiB，memory-swap=memory，逐样本断言 swap.current/max=0。实验关闭自动重启以保留首个失败；production restart 策略不改。

## 执行

在该原生 AMD64 主机的仓库根目录中，先确认独立 Engine 的归属，再创建本机 context：

```sh
docker context create ps-scheduler-amd64 --docker host=unix:///var/run/docker.sock
docker --context ps-scheduler-amd64 build --target runtime -t partsignal-scheduler-capacity:amd64 backend
docker --context ps-scheduler-amd64 pull postgres:16-alpine
docker --context ps-scheduler-amd64 pull redis:7.4-alpine
python3 .trellis/tasks/10-24-scheduler-memory-budget/run-isolated-comparison.py \
  --context ps-scheduler-amd64 \
  --image partsignal-scheduler-capacity:amd64 \
  --output .trellis/tasks/10-24-scheduler-memory-budget/evidence/amd64-24h-UNIQUE_RUN_ID \
  --checks 20 --seconds 86400
```

输出目录必须为本次独占、不存在的新路径。命令以前台持续运行；使用专用终端并确保主机不休眠。当前没有安排定时任务、远程执行或通知。脚本每两秒采样、每45秒输出进度，保存 natural health 日志、cgroup 指标、最终只读运维快照与进程日志。24小时从两组启动完成后的采样起点计算，不包含构建或迁移时间。

## 判定

- 192 MiB 是失败对照；若 OOM，保留退出码、OOM 状态及最后有效采样，不重启，不要求它继续完成20轮。
- 256 MiB 必须连续运行至少86400秒；无OOM/重启，至少20轮自然检查且全部成功，swap使用始终为0。自然检查数量通常远大于20，必须报告实际数量与检查间隔，不能只取末20条。
- 报告 cgroup 内存峰值、基线/峰值趋势、CPU限流、检查最大/P95耗时。建议峰值不超过256 MiB的85%（217.6 MiB），保留至少15%余量；超过则容量验收不关闭，不能仅凭无OOM通过。
- 核对 Scheduler tick/publish、Worker heartbeat 成功持续增长，失败计数为0；六类分钟任务与两类小时任务按原周期执行、无持续积压。24小时应覆盖小时任务，不得用短期记录代替。
- 脚本成功只表示自动化采样/短期条件完成；仍需人工核对上述余量、周期、趋势及原生架构门禁后，才能记录 `24H_PASS`。

## 停止与清理

256 MiB OOM、进程退出、采样丢失、健康失败、依赖异常、持续积压或任何意外外发迹象时，停止并保留失败证据。脚本对候选退出/采样错误自动非零；操作者发现其他指标异常时发送 Ctrl-C。禁止通过加swap、放宽检查超时或增加内存后继续计时拼接旧窗口。

正常结束或 SIGINT/SIGTERM 时脚本精确删除带本次ownership label的容器（含其匿名卷）、内网及派生health镜像tag；保留结果文件、基础镜像和构建缓存。退出后复核 `docker --context ps-scheduler-amd64 ps -a`、network/volume列表及result.json清理返回码。若 SIGKILL/掉电，则凭result中的精确资源标识恢复核对后清理，禁止全局prune。临时VM仅在确认由本轮独占创建后停止和删除。
