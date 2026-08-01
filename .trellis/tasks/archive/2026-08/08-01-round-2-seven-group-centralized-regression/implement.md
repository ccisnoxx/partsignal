# 第二轮七组修复集中回归：执行计划

## 0. 开始门禁

- [x] 用户评审并明确批准最新 `prd.md`、`design.md`、`implement.md`。
- [x] 获得批准后运行 `python3 ./.trellis/scripts/task.py start 08-01-round-2-seven-group-centralized-regression`；批准前不运行回归写操作。
- [x] 运行 `trellis-before-dev`，重新读取任务资料、相关 `.trellis/spec/`、合同和现有测试入口。
- [x] 确认主工作区为 `main`，记录 Git 状态；保留并排除 `.playwright-cli/` 与 `frontend/.playwright-cli/`。
- [x] 建立 `run-id` 和 `research/regression-matrix.md`，全部检查项初始为 `NOT_RUN`。

## 1. 冻结基线与静态清单

- [x] 记录 `git rev-parse HEAD`、Alembic current/head、Node/Python/Playwright 版本、北京时间和 Compose 服务状态。
- [x] 核对八个工作提交仍是当前 `main` 的祖先：`5808545`、`62c4e16`、`2e59943`、`95b34bc`、`6c45c09`、`f491809`、`6f8ca05`、`fab7e9c`。
- [x] 从全局动作清单复核现有资源命令面和批准排除项，没有恢复基于角色/局部状态的同类资格旁路。
- [x] 静态复核 24 表清单仍为 24 项，每项有唯一 `regionLabel`；两张弹窗项有 `dialogName`。

## 2. 必需自动化门禁

逐条运行并记录数量、耗时、失败归因与清理结果：

```bash
make contract-check
make test-unit
make test-integration
make e2e
make lint
make typecheck
make build
```

运行 `make e2e` 前先核对 `5173`、`8000`、`9001`、`19009` 的占用；当前开发前端若占用 `5173`，只临时停止该开发服务。E2E 使用共享 Redis 的独立 `/14`，结束后确认脚本清理隔离数据库/存储并恢复执行前的开发前端状态；不停止 staging 或开发 Worker/Scheduler。

- [x] `make contract-check` 证明 OpenAPI、生成类型和 `available_actions` 字段一致。
- [x] `make test-unit` 证明后端投影、前端命令消费、危险说明、焦点 Hook、favicon 资产和 Timeline 兼容测试通过。
- [x] `make test-integration` 证明 PostgreSQL 动作资格、内容任务删除合同及 AI 渠道/Header 并发删除不变量通过。
- [x] `make e2e` 已执行并确认隔离数据库与临时存储精确删除；结果为 `44 passed, 8 failed`，24 表双视口通过，失败归因见矩阵与报告，因此本项不表示门禁通过。
- [x] lint、类型检查与后端/前端镜像构建通过。

如果当前 shell 未导出 `DATABASE_URL` / `REDIS_URL`，从项目既有 `.env` 安全注入到命令环境；不得把值写入报告或终端摘要，也不得改 E2E 脚本规避隔离门禁。

## 3. 原缺陷定向核对

### 3.1 动作投影与删除并发

- [x] 从现有测试输出登记 `GenerationJob.available_actions`、已解决异常只读、非链尾 GEO 更正禁用、资源命令投影和命令最终守卫证据。
- [x] 运行 AI 配置并发删除定向用例，明确记录渠道/Header 均为 `204/404`、单一成功审计和单次失效副作用：

```bash
UV_CACHE_DIR="$(pwd)/.cache/uv" uv run --project backend pytest \
  backend/tests/integration/test_ai_channel_management.py::test_ai_configuration_concurrent_delete_has_single_successful_effect \
  -q
```

- [x] 定向复核前端三个原错误路径：终态内容任务无重试、已解决异常无创建修复表单、非链尾更正的表单/上传/提交均不可用。

### 3.2 焦点、危险说明与轻量资源

- [x] 使用现有组件测试结果核对 `useFocusReturn`、发布/审计浮层、六类危险删除说明和 Timeline 兼容断言。
- [x] 运行定向静态扫描：目标页面不再包含用户可见“物理删除”，Timeline item 不再使用旧 `children` 字段，`index.html` 只有一个 `/favicon.svg` 声明。
- [x] 使用 `playwright-cli` 命名会话执行代表性真实链；Dropdown、桌面审计和移动审计通过，发布抽屉直接关闭失败并已分流，未伪造全通过。
- [x] 浏览器打开匿名登录页和发布详情：favicon 返回 200、无 `/favicon.ico` 请求；console 无目标 Timeline 弃用警告。

### 3.3 24 表门禁

- [x] 从完整 E2E 结果单独登记“全站 24 张业务表”用例，在 `1440×1000` 与 `375×900` 对 24 项逐一命中唯一 region。
- [x] 核对“产品文章观测结果”和“远端模型列表”只在对应 dialog 内定位；源码存在唯一数量断言，背景 `.table-region` 不参与目标选择。
- [x] 不通过临时修改现有测试制造负向探针；当前精确 locator、`toHaveCount(1)` 和真实 24 项运行共同构成门禁证据。

### 3.4 共享开发对象存储

先运行无写检查：

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml config --quiet
docker compose --env-file .env -f deploy/compose.dev.yaml ps -a fake-oss
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
UV_CACHE_DIR="$(pwd)/.cache/uv" uv run --project backend pytest \
  backend/tests/unit/test_development_storage.py -q
```

- [x] `19001` 仍由 staging 占用，复用不落盘 Compose `!override` 将开发 `fake-oss` 临时映射到 `19002`，并为本轮开发 API 临时覆盖 `OBJECT_STORAGE_PUBLIC_ENDPOINT`；未停止 staging、未改 `.env` 或权威 Compose。
- [x] 使用当前后端镜像启动开发 `fake-oss`；容器持续运行，日志无 `uv run`、PyPI 或依赖同步。
- [x] 用唯一 `run-id` 对象完成 upload intent `201`、浏览器 PUT `204`、API HEAD/complete `200`、浏览器 GET `200` 与 47 字节一致。
- [x] 精确删除本轮对象和 metadata，保留 `DELETED` 墓碑；移除临时开发 `fake-oss` 与端口覆盖，恢复开发 API，保留范围外 staging 和共享历史。

## 4. 文档一致性核对

- [x] 运行旧口径清零扫描：

```bash
if rg -n '仅无生成作业且无内容版本时允许|只有在没有生成作业和内容版本时|已取消且无生成作业或内容版本|已有生产历史的取消任务继续保留|仅清理从未开始生产的取消任务|含作业或内容版本的取消任务不可删除' \
  docs/deployed-full-functional-acceptance-plan.md \
  docs/GEO多平台内容运营系统方案设计.md \
  docs/GEO系统前后端技术与部署方案.md; then
  exit 1
fi
```

- [x] 交叉核对三份活动文档、`contracts/database.md`、`0033_task_owned_history_delete.py`、删除 service 和相关集成测试均表达同一允许清理/保护历史边界。
- [x] 核对 `.trellis/spec/backend/available-actions-contract.md` 与 OpenAPI、当前 presenter、消费者和测试一致；未更新历史报告或归档任务。

## 5. 报告与退出门禁

- [x] 将每个缺陷/决策项写入 `research/regression-matrix.md`：原状态、修复提交、验证、结果、证据和残余风险。
- [x] 创建 `report.md`，汇总基线、自动化门禁、12 个问题、DEC-001/002、操作列、24 表、UI/UX、对象存储、文档一致性、清理和最终结论。
- [x] 发现的新缺陷只记录共同根因与建议的独立任务边界；未修改产品代码或现有测试。
- [x] 关闭本轮命名浏览器会话；核对本轮隔离数据库、临时存储、临时端口和对象均已清理。
- [x] 运行最终范围检查：

```bash
git diff --check
git status --short
python3 ./.trellis/scripts/task.py validate 08-01-round-2-seven-group-centralized-regression
```

- [x] 运行 `trellis-check`，复核矩阵/报告一致性、范围、失败归因、环境清理和未跟踪诊断产物排除。
- [x] 运行 `trellis-update-spec` 评估：本任务未改变实现合同；`available_actions` required 字段、焦点恢复和开发对象存储边界已有稳定 spec，本轮失败留给独立修复任务，不重复或提前修改长期规范。
- [x] 向用户展示结论和预计提交清单并取得单独提交批准；不自动推送。

## 6. 可选验证

- `make verify`：与七项门禁重复，默认不运行；只有聚合 Compose production 配置检查能提供本轮新增证据时才运行并说明原因。
- 第二次完整前端套件：本任务不再验证历史 `PS-QA-110` 的连续两轮性能目标，默认不重复。
- 全路由 W0～W6、完整 13 DELETE、真实第三方 AI、生产写入、压力/容量/渗透测试：均超出本次修复闭环范围。

## 7. 预计提交边界

工作提交预计只包含：

- `.trellis/tasks/08-01-round-2-seven-group-centralized-regression/task.json`
- `.trellis/tasks/08-01-round-2-seven-group-centralized-regression/prd.md`
- `.trellis/tasks/08-01-round-2-seven-group-centralized-regression/design.md`
- `.trellis/tasks/08-01-round-2-seven-group-centralized-regression/implement.md`
- `.trellis/tasks/08-01-round-2-seven-group-centralized-regression/research/regression-matrix.md`
- `.trellis/tasks/08-01-round-2-seven-group-centralized-regression/report.md`

不包含产品代码、现有测试、合同、迁移、部署配置、活动文档、原归档报告、`.playwright-cli/`、其他未识别文件、任务归档或会话日志。提交前必须重新展示精确文件清单并等待用户确认；归档与会话日志在工作提交之后按 Trellis 流程单独处理。
