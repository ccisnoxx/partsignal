# Frontend V2 Workbench Abstraction Review 实施计划

## 1. 启动条件

只有用户明确批准本规划后才执行：

1. 重新确认主工作区仍基于 `main`，dirty paths 仅包含已审阅的本 Task 规划产物与父 Task child metadata；若出现无法归属的用户改动，停止。
2. 运行 `python3 ./.trellis/scripts/task.py start frontend-v2-workbench-abstraction-review`。
3. 创建唯一临时分支 `codex/frontend-v2-workbench-abstraction-review`，并把 Task branch metadata 更新为该分支。
4. 使用 `trellis-before-dev` 重新加载本 Task、相关 backend/frontend/infra specs 与 planning context。
5. 不执行 pull、push、PR 或 Git 历史改写。

规划批准前不得执行以上步骤；当前 Task 必须保持 `planning`，branch 必须保持 `null`。

## 2. 精确实施范围

### 产品、测试与 Infra

1. `backend/app/schemas/workbench.py`
   - 删除 `WorkbenchAggregate.validate_attention_order`。
   - 保留 `recent_attention_items` 的 `max_length=10`、rate/window validators 与 service 排序。
2. `frontend-v2/src/domains/workbench/workbench.api.ts`
   - `queryKey` 直接使用现有 tuple；只导出 `workbenchQueryOptions`。
   - 删除无消费者的 `WorkbenchRequestError`、`status`、`detail` 与 `workbenchKeys`；错误消息和 retry 语义不变。
   - 保留本地 generated `ErrorEnvelope` guard，不迁移其他 domain。
3. `frontend-v2/src/domains/workbench/workbench.model.ts`
   - 移除 `workbenchCountLabels` 导出，map 和运行时行为不变。
4. `deploy/scripts/e2e-local.sh`
   - 仅在 `app.dev_storage:app` Uvicorn 命令增加 `--no-access-log`。
5. `frontend-v2/tests/e2e/geo-real-stack.spec.ts`
   - `requestfailed` 只保存 method 与 `new URL(request.url()).pathname`。
   - 将完整 upload URL equality 改为带语义说明的 boolean assertion，仍要求完全相等，但 failure 不打印 URL operands。

### 文档与 Task evidence

6. `docs/frontend-v2/07-migration-plan.md`
   - 仅当最终候选满足 `MET` 条件时记录 Phase 8 完成与最终证据。
7. `docs/frontend-v2/08-testing-quality-and-acceptance.md`
   - 仅当最终候选满足 `MET` 条件时记录 Phase 8 gate。
   - 明确真实安全 owner：real-stack trace 关闭；Auth/System Admin 扫描已知 password sentinels；Workbench/GEO 通过不记录 query 和关闭 dev-storage access log 防止 capability 泄漏。
   - 不声称 `e2e-local.sh` 或共享 helper 提供全局通用 secret scan。
8. 维护本 Task 的 `prd.md`、`research/audit.md`、`design.md`、`implement.md`、context manifests、`task.json` 和父 Task 当前 child/gate metadata；不改写前三个归档 Task。

除上述文件外，不修改 `03`、`05`、`09`、OpenAPI/generated types、Workbench service/router/page/route/strict fixture、V1 或旧 `frontend/`。

## 3. 实施顺序

1. 先完成三处删除式简化：backend schema duplicate validator、frontend unused public API、model unused export。
2. 完成 dev-storage access log 与 GEO failure output 的 P1 根因修正。
3. 运行 `bash -n deploy/scripts/e2e-local.sh`，只证明 shell 语法；不启动定向真实栈。
4. 自审精确 diff：确认 service/query/cache/href/state machine/fixture workflow 未改变，无新 abstraction、fallback、敏感输出或 V1 改动。
5. 固定候选后按第 4 节运行九个安全独立阶段，各一次；即使某阶段失败，也继续其他尚未执行且安全的阶段。
6. 若全部独立阶段通过，更新 `07`/`08` 条件性完成 hunks，再运行唯一一次 `make verify`。
7. 若 `make verify` 失败，先补完任何尚无独立证据且安全的阶段，批量归因；用 `apply_patch` 撤回 `07`/`08` 完成 hunks，记录 `NOT_MET`，不立即进入重跑循环。
8. 若 `make verify` 通过，运行最终 diff/Task/Git 检查并完成文档一致性与 P0/P1/P2 复核。

## 4. Required Validation

### 4.1 最小变更检查

```bash
bash -n deploy/scripts/e2e-local.sh
```

不机械重跑前三个归档 Task 的定向 Ruff/mypy/单文件 integration、两文件 Vitest/strict fixture、四条 `PARTSIGNAL_E2E_V2_SPEC=...` 真实栈命令；当前修改的交叉影响由下面根阶段覆盖。

### 4.2 安全独立诊断阶段

固定候选后，各运行一次：

```bash
make contract-check
make lint
make typecheck
make test-unit
make test-integration
make build
make e2e
docker compose --env-file .env -f deploy/compose.dev.yaml config --quiet
PARTSIGNAL_BACKEND_IMAGE=partsignal-backend PARTSIGNAL_VERSION=test \
  docker compose --env-file .env -f deploy/compose.prod.yaml config --quiet
```

执行规则：

- 一个阶段失败不阻止其他尚未执行且安全的阶段；最终一次性列出 command、owner、是否由本 Task diff 引入、是否环境问题。
- 代码、配置或环境未发生预期影响失败的变化时，不重复同一失败命令。
- `make e2e` 必须保留 database `status=dropped`、storage `status=removed`、Redis key `status=deleted` 和固定端口 `status=released`；任一 cleanup 不完整即失败。
- 不以单包成功替代根阶段，不通过修改测试放宽失败，不把数据库/权限/既有状态机/合同问题修进本 Task。

### 4.3 唯一最终 Gate

只有九个独立阶段全部通过、候选合理预期成功时，才运行一次：

```bash
make verify
```

随后运行：

```bash
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-workbench-abstraction-review
git status --short --branch
```

`make verify` 非零、post-check 非零、敏感输出或 cleanup 缺失均使 Gate=`NOT_MET`。不得在未改变代码/配置/环境时重跑 `make verify`。

## 5. Failure Attribution

| Stage | Authoritative owner | 本 Task 规则 |
| --- | --- | --- |
| contract-check | OpenAPI/generated types | 当前计划无合同改动；实际公共合同问题立即停止并成为独立 blocker |
| lint/typecheck | 具体报错 package/file | 只修本 Task diff 引入的错误，不借机清理其他 domain |
| test-unit | model/component/module owner | 只处理删除 public surface 导致的真实行为回归，不放宽 test |
| test-integration | backend/database owner | Workbench schema/service drift 可阻塞；DB/权限/原状态机问题独立 Task |
| build | backend/V1/V2 artifact owner | 三套 artifact 分别归因；V1 失败不通过修改旧 frontend 规避 |
| e2e | V2 real-stack、V1、V2 strict fixture、cleanup owner | GEO 输出修正归当前 Task；其他 workflow 失败归原 owner，批量报告 |
| Compose dev/prod | deploy config owner | 不以跳过 config 宣称 MET |

## 6. Documentation Consistency Check

最终自审必须确认：

- Workbench code 与 `03`/`05`/ADR-046 的唯一 owner、tail/null、href 和 V1 隔离一致。
- OpenAPI 与两套 generated types无 drift；否则停止并按公共合同 blocker 处理，而不是临时兼容。
- `07`/`08` 只有在最终 Gate=`MET` 时保留完成状态；`NOT_MET` 时只在 Task evidence 记录失败和 owner。
- 三个 retained P2 有明确 owner/提升条件，不被误写成已修复或 Phase 8 blocker。
- Python touched-scope 文档检查：本次只删除重复 validator/docstring，不新增或改变 developer-visible 日志/异常文本；其余改动需要在最终说明中明确。

## 7. Stop Conditions

出现任一情况立即停止对应修改并报告：

- 工作区出现无法归属或与本 Task 重叠的用户改动。
- 正确修复需要修改数据库、权限、既有状态机、公共 API、OpenAPI/generated types、V1 或旧 frontend 产品代码。
- 需要新增 Dashboard/Metric/PageHeader/Workflow/Admin/CRUD framework、shared business type、全局 store/cache、第二 query owner、第二 Workbench E2E flow 或新 dependency。
- 无法通过 Uvicorn 原生开关和 GEO 两处输出边界阻止签名 URL 泄漏，或修正会改变 storage/upload protocol。
- 任一 P0/P1 无法在精确计划范围内关闭。
- 独立阶段或最终 gate 发现敏感输出、数据完整性问题、cleanup 残留或无法归因失败。
- `07`/`08` 必须在实际 `NOT_MET` 时宣称完成。

独立 blocker 只提出计划与 evidence，不在本轮自动创建；等待用户单独授权。

## 8. Exact Rollback Strategy

- 提交前：用 `apply_patch` 仅反向撤销本 Task 在上述七个实现/文档文件中的精确 hunks；不使用 `git checkout --`、`git reset --hard`、通配删除或历史改写。
- final gate 失败：优先撤回 `07`/`08` 的 Phase 8 完成 hunks并记录 `NOT_MET`；已通过独立检查的安全修正保留供用户决定，不把失败隐藏为成功。
- 某个局部修正被证伪：只撤回该文件对应 hunk，保留其他独立修正和用户改动。
- 提交后只有用户另行授权才执行 `git revert <single-task-commit>`；不自动删除/推送分支。

## 9. Suggested Commit Scope

若最终 Gate=`MET`，建议使用一个聚焦提交：

`fix(frontend-v2): close workbench phase 8 gate`

包含五个精确实现/测试/infra 文件、最终 `07`/`08` 文档、当前 child Task artifacts 与父 Task 第四 child/gate metadata；不包含前三个归档 Task 历史、journal/archive bookkeeping、V1/旧 frontend、OpenAPI/generated types或无关 dirty files。

提交前按项目规则展示实际 `git diff --stat`/路径与 commit plan，并等待用户确认；不自动 commit 或 push。

## 10. 实际执行状态

- 五个精确实现/测试/infra hunk 已完成；未修改 service/router/page/route、OpenAPI/generated types、V1 或旧 `frontend/`。
- `bash -n`、contract-check、lint、typecheck、integration、build、dev/prod Compose config 通过。
- `make test-unit` 因既有 app-shell mock 未提供 Workbench aggregate 而失败；`make e2e` 因 Auth logout 后在途 Workbench GET 被记录为 request failure 而失败。
- `make e2e` fail-fast 未到 V2 strict fixture；安全下游诊断 `npm --prefix frontend-v2 run e2e` 进一步确认 Auth/Prompt fixture 未声明 `GET /api/v1/workbench`。
- V1 package Playwright 不自启服务；根 harness 清理后独立诊断只得到 `127.0.0.1:5173/4173` 连接拒绝，未重跑，也不归因当前产品 diff。
- 收尾 spec sync 将签名 capability 的 access-log、failure-output 与严格 URL equality 契约补入既有 `.trellis/spec/infra/e2e-isolation.md`；未新增规范文件。
- 独立阶段非全绿，故未运行 `make verify`，未修改 `07`/`08`，Phase 8 Exit Gate=`NOT_MET`。
- 当前建议不提交“close phase 8 gate”提交。若用户决定先保留已验证的安全修正与局部简化，可使用单一候选提交 `fix(frontend-v2): harden workbench diagnostics`，范围仅含五个实现/测试/infra 文件、既有 E2E isolation spec sync、当前 child Task artifacts 与父 Task metadata；仍不得宣称 Phase 8 完成。
