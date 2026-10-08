# Hostdzire 现有站点清空重建

## 当前决定与范围

用户最新原文：不需要隔离之前部署的，也不需要保留数据，因为是推到重来。

该指示覆盖此前“保留数据升级”的解释。本次在既有Hostdzire、`geo.962850.xyz`和`partsignal-staging` project上清空旧业务环境并重新安装；不执行旧数据隔离、备份、恢复或`0043 → 0066`存量迁移演练。旧preview保留数据接管修复不再适用。

获准丢弃的数据范围为当前PartSignal的`/root/partsignal-data/postgres`、`/root/partsignal-data/redis`、`/root/partsignal-data/objects`内容。这不包括其他project、整台服务器、真实OSS共享bucket、受保护runtime或TLS密钥；也不要求Docker全局prune。现有域名、网络和服务器配置继续复用。

清空会删除旧账号、业务记录、AI数据库配置、队列和本地对象；新库使用获批seed配置重新初始化。现有`/root/partsignal/shared/.env.production`及其secret继续受保护，不能用空模板覆盖或为了重建轮换密钥。

## 当前证据与候选

[只读inventory](./evidence/hostdzire-existing-site-inventory.json)于2026-10-08T01:34–01:36Z确认旧preview运行态、0043 revision、三个有数据的目录、匹配网络和root:root/0600 Production runtime。该文件中的保留数据选择是被最新指示覆盖的历史记录，不改写原观察。

应用基线候选`76d1d523b87816ba2ce52a2fc6a679144b5dab06`已通过完整make verify。fresh工具提交`3811738db696724fa948ebb133b000889c933ca8`已完成定向验证与独立复核。新源码完整候选Gate尚未运行，本机Docker不可连接；新release/images/manifest未冻结。旧SHA通过不冒充新工具完整Gate，不追加GitHub CI作为默认部署步骤。

## 执行准备与顺序

1. 在现有状态owner下实现明确的fresh-init与清空入口：删除前绑定真实candidate/run，确认固定根、普通目录、project与重叠挂载静止；仅清空上述三个目录的内容并保留目录inode，不创建quarantine。中断后同run/candidate受控续跑，目录替换/其他输入拒绝。fresh manifest声明`fresh-rebuild`恢复策略和rollback_frontend不适用；失败采用安全停止并重新安装，不依赖旧previous V2。
2. 使用真实临时目录和现有部署harness验证删除边界、中断续跑、manifest及部署激活联接；发布/数据边界执行fresh独立只读复核。未改应用行为的既有成功证据继续复用，按实际门禁裁决新候选验证。
3. 清空前补齐新安装输入：复用受保护runtime，核实真实OSS使用范围；AI清单与owner的no-echo TTY交接必须就绪。不通过development/fake适配器伪装新环境可用。
4. 在Hostdzire按固定源码构建linux/amd64镜像，检查真实image ID/RepoDigest并冻结fresh manifest。新镜像/源码/配置准备未完成前不停止现有站点。
5. 在既有站点安装同候选maintenance模板并验证Nginx/维护响应；按精确project/service/container身份停止旧服务，再由状态owner清空固定数据内容并记录真实reset阶段。
6. 在空库前滚到0066，初始化新账号，启动API/frontend；AI/OSS实际配置与验证就绪后激活Worker/Scheduler，完成登录和MANUAL主链路smoke，再开放限定内部人员访问。

## 当前实际缺口

fresh-init/reset-data已实现并完成16项fresh检查，受影响旧Production/upgrade检查通过。root同device bind缺口已修正并独立确认，见[初次复核](./evidence/fresh-init-review-initial.md)、[修正验证](./evidence/fresh-init-root-mount-validation.json)及[最终复核](./evidence/fresh-init-review-final.md)。旧状态缺失及0043存量升级不作为本次阻断。

用户已明确自定义Header应为可选，首次bootstrap路径已补齐，见[可选Header合同](./optional-bootstrap-headers.md)和[定向验证](./evidence/optional-bootstrap-headers-validation.json)。现有`.env.production.ai.json`为0600且未改写；其旧`custom_headers_required`布尔值不能推导真实Header配置，新检查返回`AI_KEY_SET_MISMATCH`，需按新版可选元数据格式更新。凭据备妥、交接负责人、TTY交接及非secret编码大小上界仍未确认；不读取或索取真实Key。当前新安装输入未就绪，不进入维护和清空。Host runtime仅声明concurrency=1，五项GEO/retention项省略；文件声明不等于三个进程实际基线。GEO enable须按PRD准备受控配置变更，不轮换secret。

## 已执行边界

已更新清空重建范围，发布工具及同步runbook已提交，定向验证/独立复核完成。旧现场inventory为只读；截至本记录尚未上传、构建、停止、删除、迁移或部署服务器环境。UAT未开始，新候选和fresh manifest尚未冻结。


## Hostdzire 直接构建与当前现场状态（2026-10-08 UTC）

源码852c6d5e完整本地Gate exit0，Hostdzire原生前后端构建与manifest/生产预检通过。真实OSS返回404/NoSuchBucket，AI初始化安排待回复；尚未维护、清空、迁移或切换。当前状态以[直接执行记录](./hostdzire-direct-build.md)为准，先前“未上传/未构建/新Gate未运行”是历史准备边界。GitHub Actions 不要求也未触发。DEPLOY保持blocked，UAT未开始。
