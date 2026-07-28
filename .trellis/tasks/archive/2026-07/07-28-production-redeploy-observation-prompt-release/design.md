# 部署设计

## 1. 发布判定

- 目标为部署文档定义的 Hostdzire staging/pre-release 公网环境 `https://geo.962850.xyz`，所有服务器写操作只通过 `ssh hostdzire`。
- 当前 `origin/main` 相比上次已验收版本变更了 `backend/alembic/versions/`，命中完整发布门禁，固定使用 `deploy/scripts/deploy-staging.sh`，不使用 fast 模式。
- 本任务只编排现有部署能力，不新增脚本、兼容层或第二套发布流程。

## 2. 发布源门禁

Trellis 规划文件本身会使工作树不再干净。规划获批并执行 `task.py start` 后，必须先单独展示提交范围并取得用户“确认提交”，再提交、推送任务状态与规划文件。随后：

1. 在 `main` 执行 `git pull --ff-only origin main`。
2. 确认工作树干净且 `HEAD == origin/main`。
3. 使用最终提交生成 `mvp-YYYYMMDD-HHMMSS-<12位提交>` release ID。
4. 通过 `git archive` 生成发布包并确认 `.trellis/`、本地认证状态与其他 export-ignore 路径未进入发布包。

应用功能提交不会因 Trellis 元数据提交而改变；最终 release commit 以执行时校验结果为准。

## 3. 只读基线与维护窗口

部署前在 Hostdzire 读取并记录：

- 主机身份、当前 `current`、Compose project、容器与健康状态、磁盘和内存余量。
- `/root/partsignal/shared/.env.staging` 存在且权限为 `0600`，只检查变量名是否齐全，不输出值。
- 当前 Alembic revision、关键表是否存在、Prompt/平台绑定数量与不可逆摘要。
- 活跃 AI 任务与 Celery 队列是否为空。

如果发现活跃写任务、环境定位不符、当前 schema 超出预期或资源不足，停止发布。进入维护窗口后停止 API、worker 和 scheduler，避免备份、迁移和验收基线之间继续写入；PostgreSQL、Redis 和对象存储保持运行。

## 4. 备份与隔离迁移演练

1. 先上传并解压待部署 release，链接既有共享环境文件，但不启动新服务或迁移正式数据库。
2. 使用既有 `backup.sh` 创建 PostgreSQL 压缩备份。
3. 补充验证文件非空、权限、`gzip -t` 和 SHA-256；不依赖脚本单独证明 `pg_dump` 流水线状态。
4. 启动临时 PostgreSQL 16，仅监听 `127.0.0.1:19002`，使用随机临时凭据和全新空数据库。
5. 将备份恢复到隔离库，确认 revision、用户表和迁移前 Prompt/平台绑定摘要。
6. 使用待部署 release 的后端在隔离库运行 `preflight-integrity` 与 `alembic upgrade head`。
7. 验证 revision 为 `0031_reusable_platform_prompts`，迁移前后 Prompt 行数和内容摘要一致，平台绑定无丢失，迁移生成的名称唯一且可追踪。
8. 删除临时容器和网络；保留真实备份及 SHA-256。全过程不输出 Prompt 正文、密码或密钥。

`0031` 虽包含迁移内一致性断言，但它会替换原表；隔离演练是本次数据安全的最高价值验证，不能以全量测试替代。

## 5. 正式发布

1. 以完整模式运行 `PARTSIGNAL_VERSION=<release-id> ./scripts/deploy-staging.sh`，由现有脚本依次构建、对正式环境执行 `preflight-integrity`、迁移、启动固定 Compose 服务、seed 与 ready 检查。
2. 核对正式 revision、Prompt/平台绑定摘要和所有服务健康状态。
3. 因本次没有 Nginx 文件变化，不安装或重载 Nginx；只运行 `nginx -t` 和既有公网安全、缓存检查。

## 6. 最小只读验收

完整部署脚本会启动全部服务，因此公网验收前再次停止 worker 与 scheduler，避免浏览器验收触发后台写入；API 与前端保留用于只读验证。

- 脚本/HTTP：宿主机 ready、首页、公网 live/ready、缓存策略、安全头和对象存储读取。
- Playwright CLI：通过真实公网域名登录，检查工作台、`/configuration/prompts`、`/configuration/platforms`、观测记录详情抽屉及外部点击关闭、洞察平台表格、发布记录表格。
- 如果存在适合的既有内容任务，只打开 AI 生成弹窗并确认可见的当前 Prompt 与已启用模型选择，不点击生成；不存在则记录该子项未覆盖，不创建测试数据。
- 检查控制台和关键请求，不接受应用错误或关键 4xx/5xx。认证信息只注入进程内存；密码提交前不输出页面快照，不保存 storage state。

验收通过后原子更新 `/root/partsignal/current`，启动 worker 与 scheduler，并再次确认 worker、scheduler、API、前端和公网健康。

## 7. 失败与回滚边界

- 备份、隔离恢复、预检或迁移演练失败：不触碰正式 schema，不发布。
- 正式迁移前失败：保持旧已验收 release，恢复停止的旧服务。
- 正式迁移后失败：旧应用与新 schema 可能不兼容，不执行 Alembic downgrade，也不自动覆盖正式数据库；优先前向修复。确需恢复备份时，必须再次取得用户明确批准，并与共享环境密钥成对处理。
- 任一验收失败时不更新 `current`，保留 release、镜像、备份和故障现场，不自动清理。

## 8. 文档与记录

任务完成时记录最终提交、release ID、迁移前后 revision、备份文件与 SHA-256、执行过的最小门禁、Playwright 覆盖和未覆盖项。部署行为未改变，因此不修改项目 Runbook；执行事实写入本任务与开发日志。
