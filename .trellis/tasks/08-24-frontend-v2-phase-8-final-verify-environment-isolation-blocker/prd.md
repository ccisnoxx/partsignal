# Frontend V2 Phase 8 Final Verify Environment Isolation Blocker

## 1. 目标

关闭 A27：为 Phase 8 最终仓库门禁建立可复用、可审计的最小进程环境，只从现有 `.env` 读取并传递 E2E 必需的 `DATABASE_URL` 与 `REDIS_URL`，不把其余开发/production 配置导入 unit、lint、typecheck 或 build 阶段。

本 Task 只验证环境 owner，不修改产品代码、测试、合同、配置、Makefile 或 E2E runner，也不运行新的 Phase 8 Exit Gate。

## 2. 已确认事实

- 来源 Task `frontend-v2-phase-8-exit-gate-recheck` 的九个独立阶段全部通过；独立 `make test-unit` 为 backend `201 passed`。
- 同一候选上的唯一最终 `make verify` 因 recheck shell 批量导出 `.env`，使 production Settings 测试先命中 `AI_ALLOW_LOCAL_HTTP` validator，backend unit 为 `200 passed / 1 failed`。
- 根 `make verify` 自身没有加载整个 `.env`：Compose targets 已显式使用 `--env-file .env`；只有 `deploy/scripts/e2e-local.sh` 要求调用环境提供 `DATABASE_URL` 与 `REDIS_URL`。
- 仓库已安装 `python-dotenv`。归档的 Phase 4 environment-corrected Task 已证明：使用 `dotenv_values()` 只读取两键、清除其余 `.env` 键后执行门禁，可以避免同类污染；不需要新增 wrapper 或 runner。
- 当前 recheck artifacts 尚未提交；本 Task 在这些 evidence 提交并回到 clean `main` 前不得启动。

## 3. Requirements

### R1. 候选与启动边界

- 等待 recheck Task evidence 按用户批准的 commit plan 提交/合入，并在 clean `main` 冻结新的起始 SHA；不吸收当前未提交文件，也不复用 recheck 临时分支实施。
- 用户批准本规划前保持 `planning`，不运行 `task.py start`、不创建分支、不执行验证。
- 实施时只写当前 Task evidence 与父 metadata；如需修改任何产品、测试、配置或 runner，立即停止并请求扩展授权。

### R2. 两键环境 allowlist

- 使用 backend 已安装的 `dotenv_values()` 在进程内读取 `.env`；禁止 `source .env`、`set -a` 或把 `.env` 全量复制到子进程。
- 只构造宿主机可访问的 PostgreSQL source URL 与动态选取的空闲、非 0、独占 Redis logical DB URL；不得输出或落盘 URL、credential。
- 从验证子进程环境中移除 `.env` 定义的其他所有键，只加入 `DATABASE_URL`、`REDIS_URL`；证据只记录交集键名恰好为这两个键。
- 不新增长期脚本、Make target、配置开关或第二套 E2E 编排。

### R3. 安全验证

- 使用现有 Redis runtime 检查和 `e2e-environment.py preflight` 验证 logical DB/固定端口；不得硬编码历史 DB，不创建 database/storage/service。
- 在同一两键子进程环境中运行一次失败 owner 的定向 backend unit，以及一次根 `make test-unit`；记录退出码和 suite 计数。
- 代码、配置、环境没有预期相关变化时不重复失败命令。
- 本 Task 不运行 `make e2e` 或 `make verify`；A27 关闭只证明环境构造正确，不能把 targeted/unit 结果宣称为 Exit Gate。

### R4. 关闭与后续边界

- A27 只有在环境交集精确、preflight 通过、定向测试与根 unit 均退出 `0`、cleanup 完整且无敏感输出时才能关闭。
- A27 关闭后只把父任务对应 blocker 标为 closed；Phase 8 继续 `NOT_MET`，等待 A28 关闭以及用户另行批准独立 Exit Gate recheck。
- 不修改 `docs/frontend-v2/07`/`08`、不开始 Phase 9、不自动提交、push、PR 或归档父任务。

## 4. Acceptance Criteria

- [ ] clean `main` 上冻结实施候选，recheck evidence 已先行提交且无未识别 dirty 文件。
- [ ] 门禁子进程与 `.env` 的键交集精确为 `DATABASE_URL`、`REDIS_URL`；未批量导出其他键。
- [ ] Redis logical DB 动态选择为非 0、空且独占，现有 preflight 通过；没有创建或清理外部资源。
- [ ] 定向 Settings unit 与根 `make test-unit` 在同一两键环境中各运行一次并退出 `0`，计数完整。
- [ ] evidence 不包含连接 URL、credential、Cookie、CSRF、headers/body、storage state 或敏感正文。
- [ ] 未修改产品、测试、合同、配置、Makefile、runner、依赖或 `07/08`，未运行 E2E/最终 Gate。
- [ ] 父任务只更新 A27 状态；Phase 8 保持 `NOT_MET`，等待 A28 和新的独立 recheck。
- [ ] 展示 commit plan 并等待批准；不自动 commit、push、PR 或 archive。

## 5. Out of Scope

- 修改 Settings、测试或 pytest 输出；这些属于 A28。
- 修改 `Makefile`、`.env`、compose、E2E scripts 或 CI workflow。
- 运行 `make e2e`、`make verify`、Phase 9 rehearsal 或 Cutover。
- 创建新的 Phase 8 recheck Task。

## 6. Blocking Questions

无。最小环境 owner、验证范围和失败边界均可由现有仓库与历史 Task 确定；等待用户批准后再启动。
