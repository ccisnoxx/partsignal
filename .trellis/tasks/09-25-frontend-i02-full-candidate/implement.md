# I02 实施顺序

1. 核对现行 Makefile、CI、测试策略、基础设施健康与端口/Redis 前置条件。
2. 在明确的宿主 PostgreSQL/Redis 测试连接下单次执行 `make verify`，持续保存完整输出与各层计数。
3. 若失败，先归因并仅修复权威 owner，运行定向回归后再恢复必要的完整门禁。
4. 核对 secret scan、数据库/Redis/端口/存储清理、完整 diff 和原工作树，安排独立复核。
5. 记录实际证据并关闭 I02，进入 I03 canonical 源码与本地集成核对。

## 实际失败与修复

1. 首次执行在 `backend/tests/unit/test_e2e_process_group_script.py` 遇到 Ruff import-order；修正导入顺序后，定向 Ruff 与 4 个脚本单元测试通过。
2. 一次执行因整体导出开发 `.env`，使 production Settings 单元测试读到 `AI_ALLOW_LOCAL_HTTP=true`，结果为 backend unit 666 通过、1 失败。确认是门禁环境污染后改为只导出测试数据库与 Redis 变量，生产代码未为此增加兼容。
3. PostgreSQL integration 暴露 duration 毫秒边界：真实快速路径可为 1ms。`test_generation_reliability.py` 保留 provider id、token、数据库回滚与 metadata 清空的精确断言，将 duration 约束改为非负整数；失败可复现，修复后连续 5 次定向通过，最终全量 337/337。
4. fixture Playwright 首轮为 492 通过、34 跳过、2 失败。认证用例在没有创建叶子 artifact 目录时收到 `ENOENT`；初步 helper 修复后，独立安全复核进一步发现动态 AI 凭据未登记、测试内 finally 早于 Playwright 晚期 artifact。最终将公共 E2E 入口改为退出后全局秘密扫描，补齐 fixture/real-stack 动态凭据登记、0600 AES-GCM manifest、NUL stdin、严格 marker 与退出码组合。
5. 独立复核随后发现 Content AI real-stack 的 6 个凭据未登记；集中到 `contentAiArtifactSecrets` 并在登录及任何页面/命令使用前登记。定向 real-stack 1/1 通过且扫描 clean，复核确认该问题关闭。
6. `npm audit` 发现传递依赖漏洞；在既有 semver 范围内刷新 lockfile。最终宿主 audit 和 Docker `npm ci` 均报告 0 vulnerabilities。

## 定向证据

- secret helper：10/10，通过 nested `EISDIR` 传播、NUL stdin 中换行与空 frame、0600/marker/加密 manifest 合同。
- late-artifact harness：受控 teardown 在测试返回后写入 secret，Playwright 退出 0、post-run scan 退出 1，且 stdout/stderr 不泄露 secret；生命周期脚本测试通过。
- 认证公共 E2E：mobile/desktop 6/6，post-run scan clean；相关 fixture 集合 42/42，scan clean。
- Content AI real-stack：1/1，scan clean，数据库、Redis、端口与临时存储清理完成。
- 秘密门禁独立复核最终结论为 `NO BLOCKER`；固定 output root 依赖串行执行，当前 Makefile/CI 门禁均为串行。

## 最终仓库级证据

命令在宿主 PostgreSQL `127.0.0.1:55432` 与独占 Redis DB 14 下单次执行 `make verify`，完整日志保存于 `/tmp/partsignal-i02-make-verify-green.log`，退出码 0：

- FastAPI runtime/OpenAPI contract 与前端生成类型检查通过；Ruff、ESLint、mypy（80 个源文件）和 TypeScript typecheck 通过。
- backend unit：667 passed；frontend Vitest：90 files / 755 tests passed；PostgreSQL integration：337 passed。
- backend/frontend Docker build 与 production build 通过；Docker `npm ci` 为 733 audited、0 vulnerabilities。
- 隔离 real-stack Playwright：16 passed；`E2E_SECRET_SCAN status=clean`，数据库、Redis DB 14、端口与对象存储完成清理。
- 完整 fixture Playwright：494 passed、34 skipped；`E2E_SECRET_SCAN status=clean`；frontend container fallback/cache/source map、post-run secret、staging/production deploy script、dev/prod Compose 配置门禁均通过。
- 非阻断输出仅为 `NO_COLOR`/`FORCE_COLOR` 提示、729.88 kB Markdown editor chunk 大小警告和 npm 升级提示。

## 收尾核对

- 门禁后端口 8000、9001、4174、19009 均已释放；Redis DB 14 为 0 key；`partsignal_e2e_%` 数据库为 0；未发现临时 E2E 目录。
- `git diff --check` 通过；原检出区 `/Users/sc/PycharmProjects/partsignal` 保持干净。
- 当前工作区的源代码、测试、Trellis 任务记录和 lockfile 差异均为本轮候选，尚未提交、发布或部署。
- 完整候选独立只读复核确认两个 P1 阻断；I02 保持进行中，未进入 I03。

## 暂停点：独立复核阻断

### 1. E2E 数据库命名与清理所有权

- `deploy/scripts/e2e-local.sh` 当前使用日期与 shell PID 构造数据库名。不同容器或 PID namespace 连接同一 PostgreSQL 时可在同一天产生相同名称。
- `e2e-database-lifecycle.sh` 在 create 命令执行前即把“尝试创建”作为清理依据；若同名数据库属于另一运行且 create 因 duplicate 失败，本运行退出时可强制删除另一运行的数据库。
- 现有测试覆盖“创建已生效但客户端命令失败”的清理，不覆盖“预存同名数据库不属于本运行”的反例。
- 恢复动作：加入足够强的随机 run ID；建立可验证的本运行所有权；同步数据库名 allowlist 与 `.trellis/spec/infra/e2e-isolation.md`；新增预存同名 duplicate 不删除测试，同时保留部分创建失败仍清理的测试。

### 2. 顶层门禁缺少生命周期故障测试

- `deploy/scripts/test-e2e-run-lifecycle.sh` 与 `deploy/scripts/test-e2e-database-lifecycle.sh` 未接入 `Makefile` 的 `test-deploy-scripts` 或其他 `make verify` 必经目标。
- 因此进程信号转发、顽固子进程升级、scanner/Playwright 退出码组合或数据库部分创建清理回归时，顶层门禁仍可能误报成功。
- 恢复动作：将两个脚本接入 `test-deploy-scripts`，确保任一失败使门禁非零；运行两个定向脚本后重新执行完整 `make verify`。

## 恢复顺序

1. 先处理数据库随机命名、所有权合同及两个碰撞/部分创建反例。
2. 将进程与数据库生命周期测试接入 `make verify` 必经目标。
3. 运行受影响的 Ruff、Python unit、两个 shell lifecycle harness 与 `git diff --check`。
4. 用仅含测试数据库和独占 Redis 变量的干净环境重新执行完整 `make verify`；重新核对端口、Redis、临时数据库和存储清理。
5. 安排独立只读复核确认两个阻断关闭；随后才能完成 I02 并创建 I03。

用户于 2026-09-25 要求完成当前复核后暂停。未修复上述阻断，未创建 I03，未提交、发布或部署。

## I02-1 恢复结果（2026-09-25）

- 已由独立子任务 `.trellis/tasks/09-25-frontend-i02-1-e2e-database-isolation/` 关闭数据库命名与所有权阻断：128 bit 随机 run ID、独立 owner marker、duplicate 不误删、post-create failure 清理、drop failure 显式失败及信号 cleanup 均具备定向反例。
- 定向证据为 Python unit 17 passed、database lifecycle harness 5 scenarios passed、相关 Ruff/shell syntax/py_compile/diff check 通过；最终独立高风险复核无阻断。
- I02 仍保持 `in_progress`。下一任务 I02-2 只处理两个 lifecycle harness 接入 `make verify` 必经目标；完整 `make verify`、资源核对与完整候选复核留给 I02-3。本会话未进入后续任务。

## I02-2 恢复结果（2026-09-25）

- 独立子任务 `.trellis/tasks/09-25-frontend-i02-2-lifecycle-gate/` 已把进程与数据库 lifecycle harness 接入 `test-deploy-scripts`；`verify` 仍直接依赖该目标，frontend container、secret artifact、staging 和 production 门禁保持不变。
- 两个 harness 分别通过，相关 shell syntax、`make -n` / 目标结构、受控 `make verify` 双故障传播反例与 `git diff --check` 通过；任一 lifecycle 非零均使顶层 Make 门禁非零且不执行后续 recipe。
- 最终独立高风险复核无阻断。按范围未运行真实 `make test-deploy-scripts` 或完整 `make verify`，也未把本地 Make 结果外推到分步执行的远端手动 CI。
- I02 保持 `in_progress`。下一任务 I02-3 只负责完整 `make verify`、资源核对与完整候选复核；本会话未创建或实施 I02-3，未进入 I03。

## I02-3 最终复验结果（2026-09-25）

- 在宿主 PostgreSQL `127.0.0.1:55432` 与独占 Redis DB 14 下，只导出 `DATABASE_URL` 与 `REDIS_URL`，以 `bash -o pipefail` 单次执行当前 `make verify`；日志 `/tmp/partsignal-i02-3-make-verify.log`，退出码 0。
- 本轮当前计数：backend unit 679 passed；frontend Vitest 90 files / 755 tests；PostgreSQL integration 337 passed；real-stack Playwright 16 passed；fixture Playwright 494 passed / 34 skipped。
- 两轮 secret scan clean；frontend container、进程 lifecycle、数据库 lifecycle 5 场景、post-run secret、staging/production deploy-script harness、dev/prod Compose config 均由顶层门禁实际执行并通过。
- 门禁后端口 8000/9001/4174/19009 释放，Redis DB 14 为 0 key，`partsignal_e2e_%` 数据库与临时 E2E/secret 目录均为 0；`git diff --check` 通过，候选代码内容哈希未变化，原检出区保持干净。
- fresh `critical_reviewer` 对相对基线 `9100774b0e124d1d834f8c726cf85f2c0e171e5e` 的全部 tracked/untracked 候选和门禁证据复核结论为 `NO BLOCKER`。
- 非阻断警告：远端手动 CI 未覆盖 frontend container、两个 lifecycle 与 post-run secret harness；当前完整工作树依赖 21 个非任务未跟踪源码/脚本/测试文件。覆盖缺口为未运行远端 Actions/真实部署、外部 AI/对象存储、Firefox/WebKit 及恶意资源所有权对抗场景。
- 多代理审计 Bundle：`20260925T165833Z-i02-3-full-candidate-independent-review-9597ace7`。
- I02 已完成；总体交付父任务继续 `in_progress`。本会话未创建 I03，未提交、归档、发布或部署。
