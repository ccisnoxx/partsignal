# Hostdzire 直接构建与部署执行记录

当前用户再次明确 GitHub Actions 不需要运行，目标为 Hostdzire 现有站点。按既有部署授权直接使用 `hostdzire` SSH 别名交付固定源码并在主机原生构建，不调用 Actions、不重新索取 Git 或清空授权。用户已经批准清空固定 PartSignal 数据；已核对现有本地配置并完成Production runtime受控交付；OSS读写正常；已确认对象私有 ACL 可保持共享 Bucket 全局设置，AI上线后UI配置方式已获选择，owner移交候选688f1ef5完整门禁通过，正在固定私有上传修正的新候选，尚未进入维护、停服、清空和应用安装。

## 已完成

- 固定应用源码 `852c6d5ea4bb6da99d4bd843271eb6634d84a3f1`，发布 ID `pilot-20261008-030536-852c6d5e`。在 clean main、HEAD=origin/main 时生成 Git archive 与真实 refs bundle；传输后主机复算摘要、clone 成独立 clean main，并确认 HEAD/origin/main 一致。后续任务记录治理提交不冒充该候选的完整门禁。
- Hostdzire 原生 linux/amd64 构建后端成功（36.33秒）、前端成功（78.33秒）。前端第一条命令误指定不存在的 `runtime` 阶段，0.41秒退出；查阅实际 Dockerfile 后使用最终匿名阶段完成构建，保留失败记录，没有重建已成功后端或覆盖已存在镜像。
- 后端镜像 ID `sha256:c7b0ed917ebfc0c7325b1d8c5ad51b0fa98c631757be94bac97a464f4e94f56e`；前端 ID `sha256:871d5203b8141fcc8718da69e3dff5997e2fcffade1bbae60a81ded2782cb1e8`。Engine 实际提供非空 RepoDigests；镜像采用 `local` 交付，不要求运行 registry 或 pull。stopped container 的 Image ID 与候选后端 ID 一致，探针已精确删除。
- 原 producer 排他生成 fresh-rebuild manifest，source archive、14项 tracked hashes、0066 schema及 migration_runtime 绑定同一候选，previous frontend 显式不适用。consumer 身份校验、Production Compose config 和真实 backend production preflight 均 exit0。清单存在不代表配置/现场 Gate 已通过。
- 保护既有 runtime，在0600暂存文件中准备 MANUAL GEO 基线：monitoring/机会显式评估 true，API/Browser false，retention dry-run true，concurrency=1。保留现有 secret 与 DB 身份；原文件仍是原 checksum。按既有 listener 渲染两份 Nginx 模板，未替换线上配置。
- 本地固定候选在2026-10-08T03:09:32Z–03:46:56Z执行原完整 `run-verify.py → make verify`，exit0，2243.89秒。3902 backend unit、1347 frontend unit、1255 PG integration、6隔离恢复、1个100000回答性能、32真实栈E2E、3 GEO模式、498 fixture及部署脚本/最终Compose通过。45项既有PG warnings、3模式skip、74 fixture skip保留，各E2E secret_scan=0。此前 bootstrap PG 环境skip不改写；当前完整PG集成覆盖已补齐。
- 本地原三个Dev容器恢复exited，临时容器无残留，Colima恢复原stopped。Redis DB13仍0、DB14仍6；集成所属DB15实际83→87，保留未知键，没有全局清理。

## 现有配置核对与实际交付（2026-10-08 UTC）

用户指出`.env`和`.env.production`已有配置后，受控比较确认两份本地OSS四项一致；此前服务器Bucket、Endpoint和Secret与本地不同，原404/NoSuchBucket来自旧服务器配置，不能据此要求用户重新提供已有配置。比较只输出配置状态、身份摘要与相等标志，无secret值。

从本地生产文件交付OSS四项到0600暂存，保留服务器既有内部secret和数据库身份；补上Settings默认预算币种USD。本地Endpoint省略协议且地域与Bucket不匹配；先规范为HTTPS，真实请求返回403/AccessDenied、公开诊断码0003-00001403。按阿里云响应Endpoint字段构造受限标准域名并用真实HEAD确认NoSuchKey，未猜测地域。该次响应HostId等于请求域名，因此不能把它误用为目标地域。地域修正后，同一凭据的实际应用服务器PUT、预签名PUT、HEAD元数据和签名下载全部成功，测试对象已精确删除。

正确配置于04:21:07Z原子安装至`/root/partsignal/shared/.env.production`，mode0600；原文件保存在受保护精确备份`.env.production.before-pilot-20261008-030536-852c6d5e`，没有轮换密码或系统密钥。安装前旧checksum与内部值一致性核验，安装后摘要为`9a84ee70df2fc404801716ebd4981754e22874c01c72465f51a232bbe52cbf60`。本地两份env的Endpoint同步为已验证地域/HTTPS，生产文件补默认币种，其他原值保留，0600备份不进入Git或发布工件。env文件更新不等于活动旧容器已加载。正确服务器运行参数随后受控同步回本地`.env.production`，mode0600、摘要与服务器完全一致；现有系统密码继续复用，真实本地backend输入预检exit0。

## 当前实际阻断

真实探针不带签名GET返回200；读取Bucket ACL确认为`public-read`，CORS配置返回NoSuchCors。这与内部/受限附件的限时访问要求不符，外部Gate不能标MET。尚未修改Bucket全局权限或CORS；已单独询问Bucket是否专用于PartSignal、是否允许改为私有并限定站点CORS。该变更可能影响其他公开用途，超出固定本地数据目录丢弃范围，不能从原清空授权推断。

旧站数据库有1渠道、1模型、0 Header，模型历史状态PASSED且启用；这里只读统计，不读取或输出API Key。AI渠道/Key储存在PostgreSQL，现有env不提供该Key，fresh-init清空会删除它；用户已选择上线后管理界面配置，因此不再要求本轮提供Key或TTY交接。该选择通过[显式部署移交合同](./admin-ui-ai-handoff.md)落实；不伪造bootstrap attempt或真实AI成功。

## 现场状态与下一步

Host工件仍绑定852c6d5e、位于`/root/partsignal/releases/pilot-20261008-030536-852c6d5e`。consumer、Compose和修正配置的真实backend production preflight均通过。上述配置交付没有改变应用源码或镜像，复用852c6d5e的既有Gate；随后用户的UI配置选择需要调整部署owner，正在准备新候选与相应验证。不触发Actions。

runtime已交付，原Nginx未改；Production cutover state仍不存在。未停止旧服务、未删除数据、未迁移目标库、未激活新Worker/Scheduler或切换公网。对象私有上传修正完成独立复核并固定新候选后继续现场阶段；AI初始化留给上线后管理界面，不假填bootstrap成功。DEPLOY恢复in_progress，UAT planned/未开始，没有部署验收、人工接受或Production Go。

原构建/完整Gate证据见[直接构建执行证据](./evidence/hostdzire-direct-build-execution.json)；本次配置比较、地域诊断、真实读写/权限结果与原子安装见[运行配置执行证据](./evidence/hostdzire-runtime-config-execution.json)。

## 688f1ef5 完整门禁与对象权限修正

AI管理界面移交候选688f1ef5在04:54:53Z–05:32:14Z完整执行原wrapper/make verify，exit0、2241.27秒，前后clean且HEAD=origin/main，env摘要未变，见[完整Gate](./evidence/admin-ui-candidate-full-gate.json)。该SHA的Host原生backend/frontend构建、manifest、生产输入与consumer通过，未切换旧站。

旧应用PUT继承Bucket公开ACL的匿名200失败证据保留。05:33后限定私有对象实验验证同次PUT header设置private、签名200、匿名/到期/未来期限的无效签名403、精确删除，Bucket全局ACL前后相同；无需旧Bucket全局修改批准，CORS在当前同源上传/新窗口下载流程不适用。应用权威storage.put新增该header，现有测试先失败再通过；最终新Host镜像仍须重验真实应用边界。没有改共享Bucket ACL/CORS，也不改已有对象。
