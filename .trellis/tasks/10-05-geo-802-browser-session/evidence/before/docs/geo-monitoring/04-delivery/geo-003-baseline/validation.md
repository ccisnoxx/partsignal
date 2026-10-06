# GEO-003 本轮验证证据

记录日期：2026-10-01。执行目录：`/Users/sc/PycharmProjects/partsignal`；分支：`geo/GEO-003`；业务源码 HEAD：`cd88fbf61d65018f7eb1a47b9f0f379ed47e3814`。Python 3.12.13、Node v24.16.0、uv 0.11.19。本任务仅新增基线文档、快照与任务记录；不会把源码存在、测试收集或 skip 算为执行通过。

## 1. 八项指定命令

| 实际命令 | 退出码 / 结果 | 原始日志 |
|---|---|---|
| `git diff --check` | 0；初始检查通过，最终文档另作临时 index 检查 | [01.log](../../../../.trellis/tasks/10-01-geo-003-current-baseline/evidence/checks/01.log) |
| `make contract-check` | 0；FastAPI 运行时完整契约一致；generated OpenAPI 类型一致 | [02.log](../../../../.trellis/tasks/10-01-geo-003-current-baseline/evidence/checks/02.log) |
| `make lint` | 0；backend Ruff、frontend ESLint 通过 | [03.log](../../../../.trellis/tasks/10-01-geo-003-current-baseline/evidence/checks/03.log) |
| `make typecheck` | 0；backend mypy、frontend typecheck 通过 | [04.log](../../../../.trellis/tasks/10-01-geo-003-current-baseline/evidence/checks/04.log) |
| `make test-unit` | 0；backend **749 passed**；frontend **91 files / 861 tests passed** | [05.log](../../../../.trellis/tasks/10-01-geo-003-current-baseline/evidence/checks/05.log) |
| `npm --prefix frontend run test` | 0；**91 files / 861 tests passed** | [06.log](../../../../.trellis/tasks/10-01-geo-003-current-baseline/evidence/checks/06.log) |
| `npm --prefix frontend run typecheck` | 0 | [07.log](../../../../.trellis/tasks/10-01-geo-003-current-baseline/evidence/checks/07.log) |
| `make verify` | **2；未完成**。contract-check、lint、typecheck、test-unit 再次通过；在 test-integration 的 Docker 调用失败 | [08.log](../../../../.trellis/tasks/10-01-geo-003-current-baseline/evidence/checks/08.log) |

精确命令、耗时和退出码另存 [commands.json](../../../../.trellis/tasks/10-01-geo-003-current-baseline/evidence/checks/commands.json)。以下是 `make verify` 实际失败阶段：

```text
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test
unable to get image 'postgres:16-alpine': failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /var/run/docker.sock: connect: no such file or directory
make: *** [test-integration] Error 1
```

Docker CLI 可调用，但本会话默认 daemon socket 不存在，backend-test 容器没有启动。这是环境阻断，不能写成 PostgreSQL 集成通过。依赖顺序尚未到达 `build`（前后端镜像）、`e2e`（real-stack + 全部浏览器 fixture）、`test-deploy-scripts`（含 frontend container）和最后的 dev/prod Compose config 检查。定向桌面 fixture E2E 的成功不替代这些未到达门禁。

恢复路径：在具备可用 Docker daemon 的开发/CI 环境执行原始 `make verify`。本轮不安装、启动或更换容器基础设施，不读取或复制真实 `.env` 内容。

## 2. GEO 定向后端与迁移

以下命令本轮确已执行；补充结果是工具输出转录，未伪称保存了不存在的原始日志，结构化记录见 [supplemental.json](../../../../.trellis/tasks/10-01-geo-003-current-baseline/evidence/checks/supplemental.json)。

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_insights.py
```

退出码 0，**8 passed**。这是纯计算边界，不依赖 PostgreSQL。

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_observation_list.py backend/tests/integration/test_geo_observation_detail.py backend/tests/integration/test_geo_observation_correction.py backend/tests/integration/test_geo_observation_deletion.py backend/tests/integration/test_geo_insights.py backend/tests/integration/test_query_topic_list.py -rs
```

退出码 0，**14 passed / 61 skipped**。通过的是可在当前环境执行的非数据库案例；数据库 fixture 因未设置 PostgreSQL 测试环境跳过。原始 skip 原因：

```text
backend/tests/integration/test_publication_workflow.py:151: 未设置 PostgreSQL 测试环境，不以 SQLite 替代 PostgreSQL
```

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_migrations.py -k 'manual_geo_migration or geo_insight_migration or geo_evidence_migration or 0043_geo_insight_platform_identity' -rs
```

退出码 0，**4 skipped / 35 deselected**；同一 PostgreSQL 环境阻断，fixture 位置为 `backend/tests/integration/test_migrations.py:51`。本轮没有执行 migration upgrade/downgrade、历史数据回填或运行库 schema 对账。

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend alembic -c backend/alembic.ini heads
```

退出码 0，输出 **`0043_geo_platform_identity (head)`**。只检查迁移源码图，不连接数据库，不代表运行库已位于该 revision。

## 3. 前端定向验证与 E2E 收集

```bash
npm --prefix frontend run test -- src/domains/geo
```

退出码 0，**13 files / 89 tests passed**。

七份现有 GEO E2E spec 的纯收集命令：

```bash
npm --prefix frontend run e2e:raw -- --list tests/e2e/geo-observations.spec.ts tests/e2e/new-geo-observation.spec.ts tests/e2e/geo-observation-detail.spec.ts tests/e2e/geo-observation-correction.spec.ts tests/e2e/geo-topics.spec.ts tests/e2e/geo-insights.spec.ts tests/e2e/geo-real-stack.spec.ts
```

退出码 0，**118 tests in 7 files**，包含 foundation-desktop 和 foundation-mobile。完整收集清单为 [09.log](../../../../.trellis/tasks/10-01-geo-003-current-baseline/evidence/checks/09.log)；118 是收集数，不是通过数。

最初使用同七份 spec 执行 `npm --prefix frontend run e2e -- --list ...`，退出码 1。Playwright 收集成功，但安全扫描 wrapper 拒绝缺少产物目录的 list 模式：

```text
Playwright 测试产物目录不存在，拒绝绕过敏感值扫描
E2E_RESULT playwright=0 secret_scan=1
```

因此只对**纯收集**使用仓库已有 `e2e:raw --list`。实际页面测试仍使用完整 wrapper，没有修改或关闭安全扫描。

实际 fixture 执行命令：

```bash
npm --prefix frontend run e2e -- tests/e2e/geo-observations.spec.ts tests/e2e/new-geo-observation.spec.ts tests/e2e/geo-observation-detail.spec.ts tests/e2e/geo-observation-correction.spec.ts tests/e2e/geo-topics.spec.ts tests/e2e/geo-insights.spec.ts --project=foundation-desktop
```

退出码 0，完成生产前端构建及 **57 passed**。原始 [10.log](../../../../.trellis/tasks/10-01-geo-003-current-baseline/evidence/checks/10.log) 最后输出：

```text
57 passed (51.0s)
E2E_SECRET_SCAN status=clean
E2E_RESULT playwright=0 secret_scan=0
```

这是六份 fixture spec 的桌面项目，不包括 `geo-real-stack.spec.ts`，也没有执行移动浏览器项目。某些桌面案例会切换 viewport，不能称为独立移动浏览器门禁。

真实栈前置检查命令：

```bash
PARTSIGNAL_E2E_SPEC=tests/e2e/geo-real-stack.spec.ts deploy/scripts/e2e-local.sh
```

退出码 1，立即失败：

```text
deploy/scripts/e2e-local.sh: line 4: DATABASE_URL: 必须设置本地或 CI PostgreSQL DATABASE_URL
```

没有启动栈或创建测试资源。缺少必需的本地/CI PostgreSQL `DATABASE_URL`；真实栈还需按原脚本满足 Redis、测试数据库/运行隔离、fake provider 与资源清理资格。未调用真实 AI 平台。

## 4. 冻结和最终文件检查

冻结脚本只读取版本化源码、OpenAPI 和 ORM metadata：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend python .trellis/tasks/10-01-geo-003-current-baseline/evidence/capture_baseline.py docs/geo-monitoring/04-delivery/geo-003-baseline
```

成功输出：12 paths、16 operations、74 schemas、7 tables、43 migrations、35 test source files、143 source files。运行时 API operation ID 与根 OpenAPI 逐项一致；schema 保留递归 `$ref` 闭包。没有 live database/network 访问。初次生成遇到组件 `$ref` 参数未展开，修正证据脚本后重新生成；不完整输出保存在工作区外临时目录，没有作为基线交付。

最终检查结果记录在 Trellis 的 [final-audit.json](../../../../.trellis/tasks/10-01-geo-003-current-baseline/evidence/final-audit.json)：

- 业务 HEAD 和 143 个冻结源文件指纹保持不变；contracts/backend/frontend/deploy 等受保护代码没有变更。
- GEO-001/002 仍为 done，只有 GEO-003 进入 review，其余任务和依赖未变化。
- JSON/YAML 可解析，快照引用、迁移图、文档相对链接有效。
- 对初始未跟踪文件使用独立临时 Git index 覆盖本任务新增/修改文档、任务源码和结构化快照的 whitespace 检查；不修改用户 index。
- 文档包 `SHA256SUMS` 覆盖其余全部文件，校验通过。

临时 index 最初包含原始日志的全量 `git diff --check` 退出 2：03～07.log 的输出末尾空行和 10.log 中 Vite reporter 的尾随空格触发诊断。原始日志逐字保留；对其余本任务文件执行 `git diff --check -- . ':(glob,exclude).trellis/tasks/10-01-geo-003-current-baseline/evidence/checks/*.log'`，退出 0。两次检查范围与实际诊断均保存于 final-audit.json。普通工作树 `git diff --check` 另行执行通过；它不会覆盖初始未跟踪文档，所以不能单独作为这些文档的验证证据。

## 5. 未验证区域与结论边界

没有运行数据库 catalog、实际 Alembic revision、GEO PostgreSQL 事务/锁/并发/触发器测试或迁移前滚成绩。真实栈 GEO Flow、移动浏览器执行、Docker 镜像/容器与部署脚本门禁没有通过证据，也没有本轮 SQL plan 或性能指标。相关源码和测试入口已保存，待合适环境运行原有检查。

本轮可以交付**当前源码/契约/页面的基线盘点**，状态为 review；不能据此称 R0 全部完成、全栈验证通过或新回答级能力已上线。
