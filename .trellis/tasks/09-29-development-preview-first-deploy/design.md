# 设计与停止条件

从清理后 `410` 且无项目容器/网络/数据目录的现场做首次部署。既有 `redeploy-staging-fast.sh` 明确要求 clean pushed main、存在 current 和已迁移数据库；本次不能走 fast。权威首次容器顺序是 `deploy/scripts/deploy-staging.sh` 的 `full`，需以新 release archive 配套调用。

先确定用户选择的外部服务策略，再固定私有 staging env。`.env` 是本机开发配置；`.env.production.ai.json` 是 Production 的非 secret 参考/交接，不被 staging 自动读取。有效的新 staging runtime 文件需使用准备工具生成的六个独立 secret 和派生 DATABASE_URL，若启用 OSS 则只从用户私有输入受控迁移四个必要值并通过 Settings/Compose 检查；不复制整个开发 env，也不覆盖旧远端配置而不留备份。

形成 clean、pushed main 的不可变源码身份及一次必要仓库门禁。构建新 release 仅由该身份的 archive，拒绝 env/secret/AppleDouble。Hostdzire 仅创建本项目精确新 release、staging runtime 备份/原子安装及空数据目录；不得触及旧冻结证据。先做回环与实际容器验证，再以当前已核验的两个 WG listener 渲染 staging Nginx 模板，同目录暂存、`nginx -t`、reload、等待公网新状态。若 final Nginx 失败，应恢复离线 site；失败时保留项目容器和证据供调查。

任何输入身份漂移、测试失败、远端其他资源变化、无凭据的真实服务需求或超时未达健康状态均 fail closed。外部写入之前冻结精确操作计划并交独立 critical reviewer。

远端旧 `.env.staging` 只含30项，虽为0600且旧运行态关键不变量成立，不能作为本次完整38项staging合同。新本地 `.env.staging` 已有38项并通过真实Settings与Compose config；首次部署须先将旧远端文件排他备份到 `shared/retired-configuration/`，再原子安装所选新配置到共享路径。安装后校验权限、完整键集和不含值的运行时摘要。若用户选择真实OSS，只改这份新staging runtime文件的必要外部字段，不碰本机 `.env` 或 Production AI操作文件。
