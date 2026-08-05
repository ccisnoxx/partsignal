# 昨日改动全站回归测试：实施计划

## 1. 启动门禁

- [x] 用户明确批准最新 `prd.md`、`design.md`、`implement.md`。
- [x] 批准后运行 `python3 ./.trellis/scripts/task.py start 08-05-yesterday-changes-regression-audit`，确认状态进入 `in_progress`。
- [x] 使用 `trellis-before-dev` 读取本任务三份规划、原任务验收矩阵、受影响 specs、合同和将要修改的完整代码。
- [x] 确认主工作目录仍在 `main`，除本任务规划文件外没有未识别改动；不创建分支、不拉取远端、不提交或推送。

## 2. 阶段 A：建立证据台账与最小基线

- [x] 新建任务 `report.md`，按合同、后端、前端、E2E、两个已报告现象记录命令、结果、失败归因和修复状态。
- [x] 记录 `git status --short --branch`、`git diff e426d7b^..949dc98 --stat` 和当前依赖/容器状态，不修改业务数据。
- [x] 先运行低成本一致性门禁：

```bash
make contract-check
make lint
make typecheck
```

- [x] 门禁均通过，无失败需要归因或修复。

## 3. 阶段 B：定向后端与前端回归

### 3.1 后端定向单元测试

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_workflow_projections.py \
  backend/tests/unit/test_platform_branding.py \
  backend/tests/unit/test_configuration_audit.py \
  backend/tests/unit/test_geo_insights.py \
  backend/tests/unit/test_security_and_publication.py
```

- [x] 覆盖 typed 投影、平台写入边界、AI 配置治理、GEO 异常回流、发布状态与权限。
- [x] 定向测试没有失败，无需修改共享函数或补充回归测试。

### 3.2 前端定向测试

```bash
# 工作目录：frontend/
npm exec -- vitest run \
  src/features/product-facts/ProductsPage.test.tsx \
  src/features/product-facts/ProductFactsPage.test.tsx \
  src/features/content-tasks/ContentTasksPage.test.tsx \
  src/features/content-editor/ContentEditorPage.test.tsx \
  src/features/publications/PublicationsPage.test.tsx \
  src/features/geo-observations/GeoObservationsPage.test.tsx \
  src/features/geo-observations/GeoInsightsPage.test.tsx \
  src/features/configuration/ConfigurationPages.test.tsx \
  src/features/configuration/PlatformTypesPage.test.tsx \
  src/features/configuration/AuditLogPage.test.tsx \
  src/features/settings/SettingsPage.test.tsx \
  src/features/users/UserManagementPage.test.tsx \
  src/shared/components/DeletionError.test.tsx
```

- [x] 重点核对主操作与更多菜单互斥、typed token 穷尽、删除条件链接、危险确认、请求 payload、错误显示和焦点返回。

## 4. 阶段 C：数据库与服务集成回归

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest \
    tests/integration/test_migrations.py \
    tests/integration/test_publication_workflow.py \
    tests/integration/test_identity_management.py \
    tests/integration/test_ai_channel_management.py
```

- [x] 迁移覆盖合法前滚、`55000` 歧义阻断、内容当前指针、发布版本快照和有损降级拒绝。
- [x] 服务集成覆盖状态转换、权限、revision、引用竞态、AI 模型发现/测试与响应投影。
- [x] 测试使用隔离环境；不在当前开发或预发布数据库手工修数据。

## 5. 阶段 D：真实浏览器回归

- [x] 先运行已存在且直接覆盖昨日行为的 Playwright Test Runner 用例；首次运行确认共享 Redis DB 0 会让常驻开发 worker 抢走隔离任务，属于既有环境问题，不归因昨日提交。
- [x] 改用未占用的独立 Redis DB 重跑；运行前从既有本地项目配置提供 `DATABASE_URL`、`REDIS_URL`，不在命令或报告中展开凭据：

```bash
deploy/scripts/e2e-local.sh \
  tests/e2e/mvp-flow.spec.ts \
  tests/e2e/ai-channel-management.spec.ts \
  tests/e2e/list-workbench-convergence.spec.ts \
  tests/e2e/cross-page-visual-convergence.spec.ts
```

- [x] 真实交互覆盖事实提交、退回修订、发布版本切换/核验/关闭、成果观测、GEO 优化、AI 模型发现、25 表主操作和桌面/移动布局；14 项全部通过。
- [x] 现有 Playwright 用例已经解释失败并覆盖请求链路，无需创建临时 `playwright-cli` 会话。
- [x] 运行前 `playwright-cli list --all --json` 确认无浏览器会话；本任务没有创建临时会话，无需关闭。

## 6. 阶段 E：已报告现象专项结论

- [x] 新增平台：用无敏感信息的测试数据覆盖合法纯域名和非法 URL/端口/通配符，核对前端 payload、422 `details.errors` 和错误展示；确认是昨日提交前已存在的前端校验/错误位置缺口，不纳入代码修复。
- [x] AI 渠道获取模型：使用 `backend/app/ai_fake_server.py` 和集成/E2E fixture 验证 `/models`、Bearer、严格 `data[].id`、`configured/primary_task` 和发现弹窗；外部域名只保留无凭据的 DNS/TLS/HTTP 状态证据。
- [x] 已公开的旧 API Key 视为失效，不读取、不调用、不写入测试或报告；真实第三方 401/403、额度和模型权限归类为供应商/凭据问题。

## 7. 阶段 F：根因修复循环

对每个确认属于昨日回归的失败依次执行：

线上已确认一个属于昨日提交的产品回归：内容版本与内容任务行虽然按 typed `primary_task` 显示“开始发布/继续发布”，但目标仍固定为内容详情或任务详情。

- [x] 线上数据库确认目标内容为当前批准版本，且没有 `publication_work`，排除发布命令已提交但后端未推进。
- [x] `git blame` 确认错误目标随 `e426d7b` 引入；修复所有受影响内容任务主入口，不修改服务端投影或公共合同。
- [x] 复用既有发布工作台和开始发布表单，通过 `content_version_id` 深链恢复目标，不新增兼容逻辑、重复写命令或第二状态源。
- [x] 新增两条最小回归测试；前端完整 Vitest 187 项、定向 30 项、变更后精确 2 项、TypeScript 与相关 ESLint 均通过。
- [x] 没有修改 Python；TypeScript 文件职责注释和开发者可见文本无需变化。
- [x] 首次 E2E 失败已归因到既有 broker 隔离缺口，使用独立 Redis DB 验证后未重复盲修。

## 8. 必需完成门禁

昨日改动影响共享 OpenAPI、数据库约束、权限和核心状态，因此最终全量验证为必需：

```bash
make verify
git diff --check
python3 ./.trellis/scripts/task.py validate 08-05-yesterday-changes-regression-audit
```

- [x] `make verify` 实际完成合同检查、lint/typecheck、完整单元与集成测试、前后端镜像构建、52 项真实 Playwright E2E 和 Compose 配置检查。
- [x] 最终差异包含当前任务文档、Hostdzire Runbook、infra spec 和发布主入口最小修复；无重复状态/权限、隐藏 fallback、宽泛异常吞噬、无关产品修改或安全退化。
- [x] `report.md` 已汇总通过项、无需修复项、非本次问题、剩余风险和文档一致性结论。

## 9. 可选检查与范围外

以下不属于本地回归完成条件，除非后续获得明确授权：

```bash
make test-deploy-scripts
npm --prefix frontend run perf:production
```

- 不部署应用，不执行远端数据迁移演练；用户已明确批准的 Hostdzire 防火墙修复按第 10 节执行。
- 不修复与昨日提交无关且未阻断本任务验证的既有问题；将其记录为独立建议。
- 不自动暂存、提交或推送。验证完成后先向用户展示提交计划并取得确认。

## 10. 线上模型发现基础设施修复

- [x] 用户澄清目标为 `https://geo.962850.xyz` 并批准 Hostdzire 防火墙修复。
- [x] 只读确认 4 次线上模型发现均在 60 秒返回 504，审计错误码为 `AI_PROVIDER_TIMEOUT`。
- [x] 确认目标域名在 Hostdzire 解析为宿主机自身公网 IP，Docker bridge 回连因 INPUT 默认 `DROP` 且缺少精确 443 规则而超时。
- [x] 按用户要求覆盖所有 Docker 项目：运行时与持久规则允许 `docker0`、`br+` 仅访问宿主机自身公网 TCP 443，保留修改前备份。
- [x] 跨 5 个 Docker 项目验证目标 HTTPS 快速返回；22/80 继续阻断，443 可达。
- [x] `iptables-restore --test`、`netfilter-persistent`、`nginx -t`、公网 smoke、API ready 与 PartSignal 容器健康均通过。
- [x] 未使用已公开的真实 API Key；真实模型列表等待用户吊销旧密钥并录入新密钥后验证。
