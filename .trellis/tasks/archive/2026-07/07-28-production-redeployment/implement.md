# 按部署文档重新部署上线：执行计划

## 0. 评审与授权

- [x] 用户批准 PRD、技术设计、维护窗口和有损迁移边界。
- [x] 确认目标就是 `https://geo.962850.xyz` 预发布环境。
- [x] 用户确认第一批生产整改，包含应用发布及后续 Hostdzire/DMIT/DNS 精确
  变更；该确认不覆盖 Git commit/push。
- [x] 已展示两组 commit 范围，明确排除 Playwright 日志和
  `.trellis/config.yaml`；用户授权提交并推送 `main`。

## 1. 清理发布来源门禁

- [x] 等待当前 PageSpeed 公网资产、主题和部署门禁修复完成；未 stash、回退、
  覆盖或临时隐藏用户改动。
- [x] 对最终待发布变更执行相称检查并提交到 `main`。
- [x] 推送后确认发布来源 clean clone 的 `HEAD == origin/main`；原工作区仅保留
  已排除的用户 Playwright 产物和 `.trellis/config.yaml`。
- [x] 运行 `node deploy/scripts/check-nginx-security.mjs`，制作安全归档并检查
  `.env.example`、密钥/环境文件、AppleDouble 和 SHA-256。

## 2. 本地质量门禁

- [x] PostgreSQL 验证 `0028 -> 0030`、空库到 head 和迁移触发器反例。
- [x] 运行观测/发布后端定向测试、前端定向测试、契约检查、lint、类型检查和生产构建。
- [x] 检查最终 diff 不包含未经批准的环境文件、凭据、临时浏览器产物或其他任务内容。

## 3. Hostdzire 前置检查

- [x] 只读确认 `hostdzire` 身份、`current`、共享环境 `0600`、容器、Nginx、磁盘和内存。
- [x] 从 Debian 官方仓库安装缺失的 `postgresql-client`，确认 `psql --version`。
- [x] 确认 `127.0.0.1:19002` 空闲、PostgreSQL 16 镜像可用，创建不可覆盖的新 release 并链接既有共享环境。
- [x] 比较 Nginx 模板和项目安全 snippet，并随同 release 更新、检查及 reload。

## 4. 维护窗口、备份与迁移彩排

- [x] 确认没有活动生成作业或待消费 Celery 队列，宣布维护窗口。
- [x] 停止旧 API、Worker、Scheduler，记录正式库 revision 与安全计数。
- [x] 生成迁移前备份，验证非空、权限、`gzip -t` 和 SHA-256。
- [x] 创建全新 tmpfs PostgreSQL 16，运行 `restore-verify.sh` 并核对 revision、关键表和计数。
- [x] 用目标后端镜像在隔离副本执行 `0028 -> 0030`，核对保留字段、删除列、数据计数和关键只读查询。
- [x] 删除一次性恢复容器和网络；正式备份及校验和保留。

## 5. 完整发布

- [x] 在停写状态运行 `PARTSIGNAL_VERSION="$RELEASE_ID" ./scripts/deploy-staging.sh`，未设置 fast 模式。
- [x] 确认正式 Alembic revision=`0030_publication_record_delete`，Compose 服务与回环探针通过。
- [x] 部署脚本完成后再次停止 Worker/Scheduler，保持浏览器验收期间无后台状态推进。
- [x] 从同一 release 安装 Nginx 模板与项目 snippet，安全检查和 `nginx -t` 通过后 reload。

## 6. 完整验收

- [x] 公网 DNS、live、ready、首页标题和对象存储代理通过。
- [x] `/assets/*`、`index.html`、SPA fallback、WOFF2 缓存与压缩头符合 Runbook。
- [x] `/`、`index.html`、真实哈希资源同时返回六项项目安全头。
- [x] Playwright CLI 完成登录前、登录后工作台和 `/configuration/ai` 只读验收，console/requests 无应用级错误。
- [x] 退出登录、关闭浏览器会话并清除运行时凭据。

## 7. 放行

- [x] 全部验收后原子更新 `current` 到新 release。
- [x] 启动并等待 Worker/Scheduler 健康，再次检查 ready、队列、容器、Nginx、内存和磁盘。
- [x] 记录 release ID、commit、备份路径、校验和、迁移 revision 和验收结果，不记录凭据或业务正文。
- [x] 未清理旧 release、镜像、备份或持久数据。

## 8. 失败处理

- [x] 迁移前失败预案未触发。
- [x] 迁移后失败预案未触发；Trusted Types 应用故障发生在迁移成功后，以新
  commit 前滚，未执行 downgrade 或裸应用回滚。
- [x] 公网入口异常时按边界只对 `dmit` 做了授权范围内诊断和精确配置变更。
