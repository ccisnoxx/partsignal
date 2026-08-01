# 共享开发对象存储启动恢复：实施计划

## 0. 开始门禁

- [x] 用户评审并批准 `prd.md`、`design.md`、`implement.md`。
- [x] 批准后运行 `python3 ./.trellis/scripts/task.py start 08-01-shared-dev-object-storage-recovery`；批准前不修改 Compose。
- [x] 运行 `trellis-before-dev`，完整读取任务文档、infra 规范和待修改文件。
- [x] 确认主工作区仍为 `main`，只保留并排除既有 Playwright 诊断产物。

## 1. 固化故障与权威对照

- [x] 记录当前 `fake-oss` 为 `Exited (1)`，日志命中 `uv run` 依赖同步/PyPI 失败。
- [x] 确认 Dockerfile 的 `/opt/venv` 与 staging 直接 Python 入口仍未变化。

## 2. 最小配置修复

- [x] 仅将 `fake-oss.command` 改为 `[python, -m, app.files.fake_server]`。
- [x] 不修改端口、volume、network、depends_on、Dockerfile、依赖或存储实现。

## 3. 必需验证

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml config --quiet
docker compose --env-file .env -f deploy/compose.dev.yaml up -d --build --wait fake-oss
docker compose --env-file .env -f deploy/compose.dev.yaml ps fake-oss
docker compose --env-file .env -f deploy/compose.dev.yaml logs --no-color fake-oss
UV_CACHE_DIR="$(pwd)/.cache/uv" uv run --project backend pytest backend/tests/unit/test_development_storage.py -q
```

- [x] Compose 配置通过，容器持续运行，日志无依赖同步或 PyPI 下载。
- [x] 开发对象存储单元测试通过。
- [x] 通过共享开发 API 完成真实 upload intent、PUT、complete/HEAD、download 和精确清理。
- [x] 使用 `playwright-cli` 命名临时会话验证现有文件页面请求；检查 console/requests，不保存持久认证状态。
- [x] 关闭本任务创建的浏览器会话，只清理本任务数据，不运行 `close-all` 或 `delete-data`。

验证记录：

- 原命令完成镜像构建后发现 `127.0.0.1:19001` 已被另一个运行 12 天的 staging `fake-oss` 占用；未停止范围外 staging 服务。使用不落盘的 Compose `!override` 临时映射 `19002`，开发 `fake-oss` 持续运行 6 分钟，日志无 `uv run`、PyPI 或依赖同步。
- 定向单测 `6 passed`。真实链为 upload intent `201`、浏览器 PUT `204`、API HEAD/complete `200`、浏览器 GET `200`，下载字节一致；随后精确删除对象和 metadata，并把无引用文件记录按现有合同转为 `DELETED` 墓碑。
- 新对象在真实浏览器中返回 `image/png`、状态 `200`、`naturalWidth=1`，无对象请求失败。唯一 console 错误为范围外的 `/favicon.ico` 404，已归入后续 `PS-QA2-UI-001` 任务。
- 既有 GEO 更正页的 `test/operation_screenshot/...` 请求仍为 ORB；服务端日志证明请求已到达并明确返回 `404 对象不存在`。共享数据库保留了隔离测试记录，而开发卷没有对应不可变历史对象；本任务不伪造历史对象，也不增加兼容 fallback。

## 4. 可选验证

- `make e2e`：隔离 E2E 使用独立临时存储，不能替代本任务共享开发 smoke；留到七项完成后的集中回归。
- `make build`：必需验证已经通过 `docker compose ... up --build fake-oss` 构建同一后端镜像，不重复单独构建。
- 全套后端测试：业务 API 和存储实现未改，只有定向测试指向共享代码回归时再扩大。

## 5. 检查、提交与归档

- [x] 运行 `trellis-check`，核对任务工件、Compose 差异、真实文件流和环境清理。
- [x] 运行 `trellis-update-spec` 判断；已新增开发对象存储运行契约并挂入 infra 索引。
- [x] `git diff --check` 通过，差异范围与 PRD 一致。
- [ ] 向用户展示提交范围并等待确认；不包含既有 Playwright 产物，不自动 push。
- [ ] 工作提交完成后执行 Trellis 收尾归档；提前说明 archive/journal 可能产生独立 bookkeeping 提交。
