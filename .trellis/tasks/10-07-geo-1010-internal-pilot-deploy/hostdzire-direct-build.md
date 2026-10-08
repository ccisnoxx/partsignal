# Hostdzire 直接构建与部署执行记录

当前用户再次明确 GitHub Actions 不需要运行，目标为 Hostdzire 现有站点。按既有部署授权直接使用 `hostdzire` SSH 别名交付固定源码并在主机原生构建，不调用 Actions、不重新索取 Git 或清空授权。用户已经批准清空固定 PartSignal 数据；当前真实 OSS 输入不可用，尚未进入维护、停服、清空和安装。

## 已完成

- 固定应用源码 `852c6d5ea4bb6da99d4bd843271eb6634d84a3f1`，发布 ID `pilot-20261008-030536-852c6d5e`。在 clean main、HEAD=origin/main 时生成 Git archive 与真实 refs bundle；传输后主机复算摘要、clone 成独立 clean main，并确认 HEAD/origin/main 一致。后续任务记录治理提交不冒充该候选的完整门禁。
- Hostdzire 原生 linux/amd64 构建后端成功（36.33秒）、前端成功（78.33秒）。前端第一条命令误指定不存在的 `runtime` 阶段，0.41秒退出；查阅实际 Dockerfile 后使用最终匿名阶段完成构建，保留失败记录，没有重建已成功后端或覆盖已存在镜像。
- 后端镜像 ID `sha256:c7b0ed917ebfc0c7325b1d8c5ad51b0fa98c631757be94bac97a464f4e94f56e`；前端 ID `sha256:871d5203b8141fcc8718da69e3dff5997e2fcffade1bbae60a81ded2782cb1e8`。Engine 实际提供非空 RepoDigests；镜像采用 `local` 交付，不要求运行 registry 或 pull。stopped container 的 Image ID 与候选后端 ID 一致，探针已精确删除。
- 原 producer 排他生成 fresh-rebuild manifest，source archive、14项 tracked hashes、0066 schema及 migration_runtime 绑定同一候选，previous frontend 显式不适用。consumer 身份校验、Production Compose config 和真实 backend production preflight 均 exit0。清单存在不代表配置/现场 Gate 已通过。
- 保护既有 runtime，在0600暂存文件中准备 MANUAL GEO 基线：monitoring/机会显式评估 true，API/Browser false，retention dry-run true，concurrency=1。保留现有 secret 与 DB 身份；原文件仍是原 checksum。按既有 listener 渲染两份 Nginx 模板，未替换线上配置。
- 本地固定候选在2026-10-08T03:09:32Z–03:46:56Z执行原完整 `run-verify.py → make verify`，exit0，2243.89秒。3902 backend unit、1347 frontend unit、1255 PG integration、6隔离恢复、1个100000回答性能、32真实栈E2E、3 GEO模式、498 fixture及部署脚本/最终Compose通过。45项既有PG warnings、3模式skip、74 fixture skip保留，各E2E secret_scan=0。此前 bootstrap PG 环境skip不改写；当前完整PG集成覆盖已补齐。
- 本地原三个Dev容器恢复exited，临时容器无残留，Colima恢复原stopped。Redis DB13仍0、DB14仍6；集成所属DB15实际83→87，保留未知键，没有全局清理。

## 当前实际阻断

真实 OSS `HEAD` 在受控新探针路径上失败；诊断保留异常因果，阿里云返回 **404 / NoSuchBucket**。当前生产 Bucket/Endpoint 组合不可用；没有执行上传、删除 Bucket或创建云资源。已请求正确 Bucket/Endpoint 或现有受保护配置记录路径，无需在聊天发送 AccessKey。源码、镜像或 Actions 不是这次阻断。

旧站数据库有1渠道、1模型、0 Header，模型历史状态PASSED且启用；这里只读统计，不读取或输出API Key。旧运行实例环境中的AI主密钥与Production引用比较不匹配，不能直接复用密文或声称已完成初始化。已询问沿用还是重新配置，未收到选择；不伪造credential owner TTY、bootstrap attempt或真实AI成功。

## 现场状态与下一步

Host新工件位于 `/root/partsignal/releases/pilot-20261008-030536-852c6d5e`。公网旧站 `/login`、`/api/health/live`、`/api/health/ready` 于03:39Z均200。原Nginx/production runtime checksum保持，Production cutover state不存在；未停止旧服务、未删除数据、未迁移目标库、未激活新Worker/Scheduler或切换公网。

闭合实际OSS配置与AI初始化安排后，使用同候选consumer再次验证配置和外部服务，然后按权威fresh-init命令完成维护→精确停止→reset-data→deploy→真实AI/OSS Gate→activate→Nginx切流→MANUAL smoke。清空范围、已授权丢弃旧数据与60分钟维护窗口合同沿用既有runbook，不要求previous V2或quarantine。DEPLOY保持blocked，UAT planned/未开始；没有部署验收、人工接受或Production Go。

完整低敏身份、命令、退出码、摘要及未执行边界见[执行证据](./evidence/hostdzire-direct-build-execution.json)。
