# 共享开发对象存储启动恢复

## 1. 目标

修复第二轮全项目回归登记的 `PS-QA2-ENV-001`，使共享开发 Compose 中的 `fake-oss` 不依赖容器启动阶段访问 PyPI，即可持续运行并支持 API 的真实上传、完整性确认、下载和清理流程。

## 2. 已确认事实

- `deploy/compose.dev.yaml:83-91` 的 `fake-oss` 使用 `uv run python -m app.files.fake_server`，并把 `backend/` bind mount 到 `/app`。
- 当前容器退出码为 1；日志显示 `uv run` 在运行阶段解析或下载 `hatchling`、`pillow`，网络/DNS 失败后退出。
- `backend/Dockerfile:1-16` 已在构建阶段把运行依赖安装到 `/opt/venv`，并把该虚拟环境加入 `PATH`。
- `deploy/compose.staging.yaml:57-63` 已直接使用 `python -m app.files.fake_server`，证明开发服务无需通过 `uv run` 启动。
- 隔离 E2E 自带临时对象存储并已通过，因此本任务只恢复共享开发栈，不改变 E2E 隔离合同。

## 3. 范围内需求

### R1. 使用镜像既有运行环境启动

- 将开发 Compose 的 `fake-oss` 命令改为直接运行 `python -m app.files.fake_server`。
- 启动过程不得执行 `uv` 项目同步或访问 PyPI。
- 保持现有端口、bind mount、命名卷、网络和对象存储配置不变。

### R2. 验证真实共享开发文件流

- `fake-oss` 必须持续运行，日志中不得出现依赖下载或同步失败。
- API 必须能通过共享开发对象存储完成真实上传、HEAD/完整性确认、下载和删除。
- 浏览器侧至少验证一次现有文件页面的对象请求，不得再出现由对象存储不可用导致的 ORB/连接失败。
- 测试只清理本任务创建的对象和业务记录，不清扫共享开发历史。

### R3. 保持现有边界

- 不修改 Dockerfile、`pyproject.toml`、`uv.lock`、对象存储协议、业务 API 或数据库合同。
- 不增加 healthcheck、API `depends_on` 或在线同步 fallback；这些都不是已确认根因。
- 不影响隔离 E2E 的临时数据库、临时存储和精确清理语义。

## 4. 范围外

- 不处理阿里云 OSS、生产/预发布部署、对象存储容量或性能。
- 不处理 `PS-QA2-FUNC-*`、焦点、删除文案、favicon、Timeline、24 表门禁或验收文档。
- 不删除、移动或提交用户既有 `.playwright-cli/` 和 `frontend/.playwright-cli/` 诊断产物。

## 5. 验收标准

- [x] AC1：开发 Compose 配置解析成功，`fake-oss` 使用直接 `python -m app.files.fake_server`。
- [x] AC2：重建并启动 `fake-oss` 后容器持续运行，日志无 PyPI/依赖同步尝试。
- [x] AC3：开发对象存储单元测试通过，PUT、HEAD、GET/下载和幂等 DELETE 语义不回归。
- [x] AC4：共享开发 API 与 `fake-oss` 完成一次真实上传、完整性确认、下载和清理，且只删除本任务创建的数据。
- [x] AC5：真实浏览器文件请求无对象存储连接失败或 ORB；API、PostgreSQL、Redis、Worker、Scheduler 和前端现有健康状态不回归。
- [x] AC6：任务差异仅包含开发 Compose、必要测试/规范和 Trellis 任务材料；不包含用户诊断产物、依赖或产品合同改动。

## 6. 约束与风险

- 启动成功本身不构成验收，必须完成真实对象读写。
- 如果直接 `python` 报缺少运行依赖，应返回规划阶段核对镜像构建，而不是恢复 `uv run` 或增加联网 fallback。
- 本任务没有未决产品、兼容或数据迁移决策。
