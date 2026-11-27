# 设计与停止条件

从清理后 `410` 且无项目容器/网络/数据目录的现场做首次部署。既有 `redeploy-staging-fast.sh` 明确要求 clean pushed main、存在 current 和已迁移数据库；本次不能走 fast。权威首次容器顺序是 `deploy/scripts/deploy-staging.sh` 的 `full`，需以新 release archive 配套调用。

本次预览固定使用开发 fake-oss 和确定性 AI。`.env` 是本机开发配置；`.env.production.ai.json` 是 Production 的非 secret 参考/交接，不被 staging 自动读取。新 staging runtime 文件由准备工具生成六个独立 secret 和派生 DATABASE_URL，通过 Settings/Compose 检查；不复制整个开发 env。替换旧远端配置前保留受控备份。

形成 clean、pushed main 的不可变源码身份及一次必要仓库门禁。构建新 release 仅由该身份的 archive，拒绝 env/secret/AppleDouble。Hostdzire 仅创建本项目精确新 release、staging runtime 备份/原子安装及空数据目录；不得触及旧冻结证据。先做回环与实际容器验证，再以当前已核验的两个 WG listener 渲染 staging Nginx 模板，同目录暂存、`nginx -t`、reload、等待公网新状态。公网根页面、JS、live/ready 必须精确返回 200，并含六项精确安全头；`current` 链接必须在 Nginx 回滚保护仍生效时设置并复验。失败时恢复离线 410，保留项目容器和证据供调查。

任何输入身份漂移、测试失败、远端其他资源变化或超时未达健康状态均 fail closed。外部写入之前冻结精确操作计划并交独立 critical reviewer。

远端旧 `.env.staging` 只含 30 项，不能作为本次完整 38 项 staging 合同。新本地 `.env.staging` 已通过 Settings 与 Compose config；首次部署先将旧远端文件排他备份到 `shared/retired-configuration/`，再原子安装新配置到共享路径。安装后核对权限、SHA-256 与 Compose config，不打印值；本机 `.env` 与 Production AI 操作文件保持本机归属。
