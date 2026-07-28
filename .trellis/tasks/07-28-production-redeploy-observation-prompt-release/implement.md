# 实施计划

## 阶段 0：批准与发布源准备

- [x] 用户批准本 PRD、部署设计和实施计划。
- [x] 运行 Trellis `task.py start`，确认任务进入开发阶段。
- [x] 展示仅包含本任务规划/状态文件的提交计划，取得用户单独“确认提交”。
- [ ] 提交并推送任务文件；在干净 `main` 上执行 `git pull --ff-only origin main`。
- [ ] 验证 `git status --short` 为空，`git rev-parse HEAD` 与 `git rev-parse origin/main` 相同。

## 阶段 1：本地最小发布门禁

- [ ] 记录最终 commit 和 release ID：`mvp-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short=12 HEAD)`。
- [ ] 运行 `node deploy/scripts/check-nginx-security.mjs`。
- [ ] 使用 `git archive` 生成 release 包，检查归档可读且未包含 `.trellis/`、本地认证状态、环境文件或其他 export-ignore 内容。
- [ ] 不重复运行全量后端、前端、构建或 E2E 套件；远端构建属于正式部署，数据迁移由隔离演练直接验证。

## 阶段 2：Hostdzire 只读预检

- [ ] 仅通过 `ssh hostdzire` 确认主机身份、目录、`current`、Compose project 与当前服务状态。
- [ ] 检查共享环境文件存在且权限为 `0600`，只核对变量名，不输出变量值。
- [ ] 检查磁盘、内存、Docker、PostgreSQL 版本及临时端口 `127.0.0.1:19002` 可用。
- [ ] 记录正式库当前 revision、Prompt/平台绑定数量与内容摘要，不输出 Prompt 正文。
- [ ] 确认没有活跃 AI 生成任务或待处理队列；否则停止并报告。

## 阶段 3：维护窗口、备份与隔离演练

- [ ] 停止 API、worker、scheduler，复核没有继续写入。
- [ ] 上传并解压 release，链接 `/root/partsignal/shared/.env.staging`，但不启动新服务或迁移正式数据库。
- [ ] 运行既有 `deploy/scripts/backup.sh` 创建备份。
- [ ] 验证备份非空、权限正确、`gzip -t` 成功并记录 SHA-256。
- [ ] 在 `127.0.0.1:19002` 启动临时 PostgreSQL 16，以随机临时凭据恢复到全新空数据库。
- [ ] 在隔离库确认恢复 revision 和迁移前 Prompt/平台绑定摘要。
- [ ] 使用待部署 release 的后端运行 `preflight-integrity` 和 `alembic upgrade head`。
- [ ] 验证 `0031`、Prompt 行数/内容摘要、平台绑定和迁移名称约束。
- [ ] 移除临时数据库容器与网络；保留正式备份和 SHA-256。

## 阶段 4：完整发布

- [ ] 执行 `PARTSIGNAL_VERSION=<release-id> ./scripts/deploy-staging.sh`，不设置 fast 模式；由脚本在正式数据库运行 `preflight-integrity` 后迁移。
- [ ] 验证正式 Alembic revision 为 `0031_reusable_platform_prompts`，Prompt/平台绑定摘要符合迁移前基线。
- [ ] 检查固定 Compose 服务、宿主机 ready 和首页；运行 `nginx -t`，不安装或重载 Nginx。

## 阶段 5：公网只读验收

- [ ] 再次停止完整部署脚本已启动的 worker、scheduler，检查公网 live/ready、首页、缓存、安全头和对象存储读取。
- [ ] 使用项目 `playwright-cli` 的临时认证会话登录真实公网域名。
- [ ] 只读检查工作台、Prompt 管理、平台绑定、观测详情关闭、洞察平台表格和发布记录表格。
- [ ] 有既有合适内容任务时，只打开 AI 生成弹窗确认 Prompt 与已启用模型，不点击生成；没有数据则记录未覆盖。
- [ ] 检查浏览器控制台和关键请求无应用错误；关闭会话且不保存认证状态。

## 阶段 6：接受、恢复后台服务与记录

- [ ] 全部强制验收通过后原子更新 `/root/partsignal/current`。
- [ ] 启动 worker 与 scheduler，再次检查所有容器、worker/scheduler 健康和公网 ready。
- [ ] 记录最终 commit、release ID、revision、备份 SHA-256、执行结果、跳过的全量测试及残余风险。
- [ ] 若任一强制验收失败，不更新 `current`、不 downgrade、不清理现场；按设计中的失败边界报告并等待决定。

## Required Validation

以下是本次必须完成的验证：

- 本地发布源：干净 `main`、`HEAD == origin/main`、安全配置检查、release 归档检查。
- 数据：非空备份、`gzip -t`、SHA-256、全新隔离库恢复、`0030 -> 0031` 演练及 Prompt/绑定摘要一致性。
- 部署：正式 `preflight-integrity`、Alembic head、Compose/ready/首页、`nginx -t`。
- 公网：live/ready、缓存与安全头、对象存储读取、Playwright 关键页面只读验收。

## Optional Validation（本次明确跳过）

- 全量 backend pytest。
- 全量 frontend Vitest、lint、typecheck 与本地 production build。
- 全量 Playwright E2E 或创建线上测试数据的流程。

跳过原因：这些检查已在功能开发任务中完成过或不能直接提高本次部署迁移的证据质量；远端构建、隔离迁移演练和真实公网只读验收覆盖本次最高风险。残余风险是无既有合适内容任务时，AI 生成弹窗只能在后续允许写入的业务验收中补测。
