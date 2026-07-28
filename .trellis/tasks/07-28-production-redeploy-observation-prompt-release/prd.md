# 生产环境重新部署观测与 Prompt 优化

## Goal

依据仓库当前 Hostdzire 部署 Runbook，将已推送到 `origin/main` 的观测、发布列表与可复用 Prompt/AI 生成优化重新部署到公网目标 `https://geo.962850.xyz`，安全执行数据库迁移并完成最小上线验收。

## Background

- 用户已明确本地代码全部提交并推送，要求根据部署文档重新部署上线。
- 仓库文档将该公网目标定义为 Hostdzire staging/pre-release 环境，Compose project 为 `partsignal-staging`；本任务不自行改变环境定位。
- 上次部署日志记录的已验收版本为 `mvp-20260728-170942-c31d455d3753`，当前本地与 `origin/main` 均为 `1aeb8e7b4c43b4c085b953d5f45eebf2e0e30547`。执行阶段必须重新读取远端状态，不把规划时快照当作实时事实。
- 本次 release 包含数据库 revision `0031_reusable_platform_prompts`。该迁移会建立独立 Prompt 表、迁移现有内容与平台绑定、校验一致性，再删除旧表并重命名，因此不能走跳过备份和迁移的快速重部署。
- 服务器写入目标只能使用 SSH alias `hostdzire`；`dmit` 只允许在公网入口异常时做只读诊断。
- 用户此前要求避免全量测试和长时间测试；部署前后只执行 Runbook 强制门禁与本次变更相关的最小验收。

## Requirements

- **R1 权威版本**：只部署干净、已推送且与 `origin/main` 一致的本地 `main` 提交，不部署工作树或未推送内容。
- **R2 完整发布**：按 Hostdzire 完整发布流程执行，不使用 `PARTSIGNAL_DEPLOY_MODE=fast`，不跳过数据库备份、迁移、健康检查或公网验收。
- **R3 数据保护**：迁移前确认现有数据并生成非空 PostgreSQL 备份；验证权限、压缩包完整性、SHA-256 与隔离恢复结果。备份与共享环境中的 `AI_CREDENTIAL_ENCRYPTION_KEY` 必须成对保护，不读取或输出密钥值。
- **R4 迁移门禁**：先在隔离恢复库使用待部署后端演练 `0030` 到 `0031`，验证 Prompt 数量、内容摘要与平台绑定保持一致；正式环境再执行只读 `preflight-integrity` 和 Alembic 到 `head`。任何预检、迁移或恢复验证失败都停止发布。
- **R5 服务发布**：通过仓库既有 release/Compose 脚本构建并替换固定 Hostdzire 栈。本次没有 Nginx 模板或安全片段变更，因此不安装或重载 Nginx，只执行 `nginx -t` 与公网安全头检查；不修改 DNS、HSTS、DMIT 或持久化目录。
- **R6 最小验收**：只执行部署脚本健康检查、真实公网只读浏览器检查和本次变更相关的最小页面验收，不运行全量后端、前端或 E2E 测试。
- **R7 成功记录**：全部验收通过后才原子更新远端 `current`；失败时保留 release、镜像、备份和故障现场，不做 Alembic downgrade 或自动清理。
- **R8 无写入验收**：浏览器验收只使用既有数据；没有可用内容任务时不创建数据或触发 AI 生成，将该子项记录为未覆盖的残余风险。

## Acceptance Criteria

- [ ] 最终 release source 为本地干净的 `main`，`HEAD` 与 `origin/main` 完全一致，release ID 使用秒级时间戳和 12 位提交。
- [ ] Hostdzire 共享环境文件、权限、`current`、磁盘空间和既有生产数据通过只读门禁。
- [ ] 迁移前 PostgreSQL 备份非空、权限正确、`gzip -t` 和 SHA-256 通过，并在全新隔离数据库完成恢复验证。
- [ ] 隔离库迁移演练与正式 `preflight-integrity` 均无阻断项；Alembic 成功升级到 `0031_reusable_platform_prompts`，Prompt 数量、内容摘要和平台绑定校验通过。
- [ ] 生产 Compose 服务健康，宿主机 ready、首页与公网 `https://geo.962850.xyz` 均通过部署脚本检查。
- [ ] Playwright 通过真实公网域名验证登录页、认证后工作台、Prompt 管理、内容任务 AI 弹窗、GEO 观测/洞察和发布记录关键只读行为；控制台与关键请求无错误。
- [ ] 验收期间不创建业务数据、不修改线上 Prompt、模型、平台绑定或其他配置。
- [ ] 验收全部通过后 `current` 指向新 release；失败则保持最后已验收 release 记录并按 Runbook 处置实际运行栈。
- [ ] 未运行全量测试，已明确记录所执行的门禁、结果、release ID、部署提交和残余风险。

## Out of Scope

- 修改产品代码、部署脚本、Compose、Nginx、DNS、HSTS、证书、DMIT 或 OSS 配置。
- 清理旧 release、镜像、备份或 `/root/partsignal-data`。
- 写入式线上业务验收、创建测试 Prompt/平台/任务或真实调用第三方 AI。
- Alembic downgrade、生产主库覆盖恢复或自动回滚数据。
