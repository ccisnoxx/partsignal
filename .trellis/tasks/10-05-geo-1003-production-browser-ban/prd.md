# GEO-1003：生产环境硬禁止 Browser Collection

- 授权：当前用户明确要求实现及定向验证；仅交付 review，不自行 done，不部署或提交。
- 目标：production Settings、输入检查和生产部署入口明确拒绝 Browser=true；API/Worker/Beat 使用同一最终配置。
- 边界：production Compose 移除 Browser include，所有 profile 展开为零 Browser 服务/会话；生产启动固定 APP_ENV=production，保留 Browser 原始配置以失败，不能强制覆盖为 false 掩盖错误。
- 部署入口：复用输入检查脚本，在维护锁/状态变更前拒绝 Browser 开关、非生产环境、非权威 Compose/Browser profile 和会话材料。输入检查接受旧 runtime 省略 Browser，显式值只接受 false。
- 非生产：保留 GEO-801～803 骨架/会话/本地合同，不实现 Adapter；独立 Collector 对 production 在浏览器启动前拒绝。
- 验证：Settings 单元、production boundary、production input checker、真实 Docker Compose config（默认/async/geo-browser/全部 profile/环境覆盖）、API/Worker/Beat 与 preflight 启动负例、定向 Browser 合同、git diff --check。
- 恢复：回滚本任务源码即可；无数据库/API schema/数据迁移。旧 manifest 因生产文件或新增 checker 身份变化须重新生成，由 GEO-1009 冻结候选；生产零材料现场证据仍属 GEO-1010。
- 依据：用户要求；GEO-1003 manifest/WBS；docs/production-configuration.md；infra production-image-delivery spec；现有配置与本地 Browser 合同。
