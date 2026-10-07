# GEO-1003 独立只读复核

复核者：fresh critical_reviewer；不是实施代理。复核任务为 geo_1003_review，只读范围为本任务候选、配置/部署源码及权威文档；普通业务全仓 diff 不作为本次候选。

## 结果

确认的 1 项 P2 已修复并复核解除，当前未确认剩余发布阻断或生产 Browser 绕过。

- 已修复 P2：Hostdzire 附录 candidate 命令仍传旧 8 项，会在 producer exact allowlist 匹配时失败。主代理补入 checker 并更新上线流程；复核者独立用 AST/正则确认 producer/consumer/附录命令的 9 项完全相等，直接 preflight 在 Compose 前调用边界检查。
- Production Settings/启动/会话拒绝、API/Worker/Beat 配置来源、preflight 与 Collector 启动顺序检查通过。生产三个部署脚本在维护锁/状态变更/Compose 前拒绝；显式权威 -f 与 profile allowlist 没有经入口恢复 Browser 的路径。Collector 先于 Chromium/健康/session 拒绝 production。
- manifest producer/consumer/测试集合一致，旧 manifest 拒绝为明确合同变化；frontend rollback 状态/镜像检查保持。非生产父子开关、Browser 骨架/会话和 GEO-803 模拟合同未发现退化，未新增真实 Adapter 或假成功。

复用主代理已执行的 152 项后端、17 启动正例/生产负例、Compose profile/环境覆盖、Collector 14 项、GEO-803 27 项和部署自检，没有重复测试。复核者另外检查原候选 28 个维护文件快照及 runbook 集合；主代理在结束后确认最终 30 个源文件摘要未发生未解释变化（review-source-verification.json）。

## 覆盖边界

目标生产实机三进程实际配置、现存 Browser 容器/挂载/session/key 材料与新候选镜像/完整发布门禁未验证，仍由 GEO-1009/1010 收口。结论支持交付 review，不代表人工接受、done 或生产放行。
