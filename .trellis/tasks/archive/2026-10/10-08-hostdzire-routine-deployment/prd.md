# Hostdzire 日常部署与增量验证

## 目标

将代码验证与部署交付分开，日常部署不自动运行完整 make verify。复用输入未变的成功证据，部署仍校验候选/配置/状态/镜像与真实健康。常规无迁移重部署目标5–15分钟，仅作为待测目标。

## 授权与范围

用户已授权执行推荐方案。本任务修改仓库规则、Production日常入口与定向验证；不执行远程发布、Git提交/push、数据清空或凭据修改。沿用main，保留无关工作。

## 验收

- 日常重启同候选不构建、不迁移、不创建upgrade、不改变持久阶段；经现有维护锁及supervisor治理。
- 无schema变化的新版本可通过明确的分阶段Production入口check/prepare/activate/smoke交付；迁移变化拒绝日常入口并明确指向Runbook。
- 不自动运行make verify/全量E2E/性能检查；manifest/image/config/maintenance guard/activation安全要求保留。
- smoke验证固定候选实际API/Frontend/Worker/Scheduler身份、DB schema、live/ready、登录页与匿名受保护API拒绝；可用既有会话做只读业务检查，无凭据argv或日志。
- 更新CI/Production权威规范和历史任务当前适用说明，使新SHA不机械触发全套验证；不改历史结果。
- 直接相关行为测试及独立只读复核通过；如无现场运行，明确不宣称已部署或达到时间目标。

## 排除

不新建通用CI框架、自动测试依赖图、registry、外部服务适配器或API/数据库合同。不删除正式release能力，不自动修改Nginx/恢复流量，不绕过失败状态。
