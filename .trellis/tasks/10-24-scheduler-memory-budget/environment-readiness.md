# 原生 AMD64 环境核对（2026-10-24）

历史记录说明：2026-10-25用户已取消新建/取得独立AMD64测试机这一前置，当前采用[现有线上Docker最小变更方案](online-memory-change-plan.md)，尚未执行。以下资源快照及原隔离试验结论保留为历史，不代表当前必须继续寻找测试环境，也不代表本轮重新核查过VPS。

## 结论

用户已授权：先检查现有环境，满足条件则启动24小时验收。此次实际核对本机、现有Colima与SSH配置中的dmit、hostdzire、cox、pub；四个SSH目标均连接成功，但没有发现满足既定方案的原生AMD64隔离环境。24小时状态保持 `NOT_STARTED`，原因是环境前置条件不满足，不是等待重复授权。

证据见 `evidence/amd64-environment-inventory.json`。以下内存为探测时的MemAvailable瞬时值，不代表可长期保留给测试的配额；SSH目标名称来自当前配置，没有采用历史aaitr别名。

| 环境 | 架构/资源 | 现有使用与阻断 |
| --- | --- | --- |
| 本机及两个Colima profile | ARM64 / aarch64；profile均Stopped | 不能替代原生AMD64，不启动模拟架构验收 |
| dmit | x86_64，1核，约959MiB总内存、587MiB可用，cgroup v2 | 已有nginx/sing-box等入口服务；无Docker/Podman，不具备独立测试Engine及当前双组验收资源条件 |
| hostdzire | x86_64，4核，约5.80GiB总内存、3.36GiB可用，cgroup v2 | 唯一已配置Docker context为default，16个容器全部运行，承载PartSignal等服务；方案明确排除该生产Engine |
| cox | x86_64，1核，约727MiB总内存、390MiB可用，cgroup v2 | 已有sing-box入口服务；无Docker/Podman/Python3，不具备验收运行条件 |
| pub | x86_64，4核，约15.11GiB总内存、1.15GiB可用，cgroup v1 | default Engine中31个容器全部运行；不满足cgroup v2和空独立Engine要求 |

四台远端均报告KVM虚拟化、没有 `/dev/kvm`，且未发现rootless Docker socket、virsh或qemu-system-x86_64。没有证据表明存在另一台已准备的测试VM。以上结论仅覆盖本次可访问的已配置目标，不代表账户中不存在尚未提供接入信息的云资源。

未通过新建共享宿主Docker daemon或Docker-in-Docker绕过空Engine要求：这不能证明宿主CPU/内存与线上服务隔离；也未安装软件、切换cgroup、调整宿主配置或购买新实例。

## 缺少的条件

1. 一个可访问、确属测试专用的原生x86_64 Linux主机/VM，使用cgroup v2；不复用上述生产Docker Engine、数据卷和运行配置。
2. 为PG、Redis、两组worker/beat、观测与迁移提供独立资源。建议准备至少2vCPU、4GiB RAM、20GiB磁盘并保留足够空闲空间；这与已完成短测的环境规格一致，是起步规格，不是经证明的AMD64最低要求。Scheduler两组固定0.5CPU、192/256MiB、无swap。
3. 空Docker Engine、Compose插件、Python3和可用本机Unix socket；同一候选源码、Dockerfile、uv.lock对应的原生AMD64镜像及PG/Redis镜像准备完毕、身份记录完整。
4. 能连续运行24小时、不受SSH断开或休眠影响的执行会话与持久证据目录；登记启动时间、PID/作业标识、停止和精确清理入口。当前未启动后台进程或设置自动化。

具备这些条件后，按acceptance-plan.md开始新的完整86400秒窗口。已有ARM64短测证据保留，但不能抵扣24小时或原生AMD64要求。

## 本轮实际操作

本地执行 `uname -m`、`docker context ls --format '{{.Name}}'`、`colima list --json`，检查SSH alias及非敏感连接选项。对四个目标执行 `ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=yes ALIAS 'sh -s'`，只读采集uname/getconf、systemd-detect-virt、/proc/meminfo、/proc/loadavg、df、cgroup类型、工具存在性、Docker info/ps/context、运行服务名称、/dev/kvm及/run/user下Docker socket。

没有执行测试环境创建、构建或24小时驱动；没有线上配置修改、服务重启、部署、业务写入、外部AI调用或Git暂存/提交/推送。本轮只增加/更新本地任务证据和状态说明，不重跑上轮容量或单元测试。
