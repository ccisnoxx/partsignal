# Research: Workbench E2E 与 Infra 审计

- Query: 审计 Workbench strict fixture、四个加入 Workbench 检查点的 real-stack specs、`deploy/scripts/e2e-local.sh` 与测试产物约定，判断测试分层是否互补、是否重复编排、是否存在敏感输出风险，并整理 Phase 8 最终验证与归因规则。
- Scope: internal
- Date: 2026-08-23

## Findings

### 1. 文件范围

- `.trellis/spec/frontend/quality-guidelines.md`：production-artifact、real-stack trace、浏览器错误与敏感产物边界。
- `.trellis/spec/frontend/state-management.md`：TanStack Query、URL/local state 与禁止第二状态源的稳定约束。
- `.trellis/spec/infra/e2e-isolation.md`：唯一真实栈编排、定向模式、资源隔离和 cleanup 合同。
- `.trellis/spec/infra/ci-execution.md`：`make e2e`、`make verify` 与手动 CI 的职责。
- `frontend-v2/src/domains/workbench/workbench.model.test.ts`：generated union、六类 count、href passthrough 与 nullable rate 的纯映射测试。
- `frontend-v2/src/domains/workbench/workbench-page.test.tsx`：单 aggregate GET、页面区块、error/retry/empty/zero/null 的 component owner。
- `backend/tests/integration/test_workbench.py`：角色、`REPEATABLE READ`、六类业务口径、GEO current tail、排序、敏感字段缺席和固定查询数 owner。
- `frontend-v2/tests/e2e/fixtures/workbench.fixture.ts`：production build 的 auth + 单 Workbench GET allowlist 与运行时错误审计。
- `frontend-v2/tests/e2e/workbench.spec.ts`：production artifact 的六类展示、href passthrough、键盘顺序、四档宽度和 fatal/retry/empty/zero/null。
- `frontend-v2/tests/e2e/product-facts-real-stack.spec.ts`：待审核事实自然状态中的 Workbench count/item/href/Fact Review 导航。
- `frontend-v2/tests/e2e/content-review-real-stack.spec.ts`：待审核内容自然状态中的 Workbench count/item/href/Content Review 导航。
- `frontend-v2/tests/e2e/publication-workspace-real-stack.spec.ts`：同一 Publication Flow A 的 PREPARING、AWAITING_VERIFICATION、OPEN issue 三个检查点。
- `frontend-v2/tests/e2e/geo-real-stack.spec.ts`：同一 correction chain 的 PARTIAL root 与 UNJUDGEABLE tail 检查点及 nullable rate。
- `frontend-v2/playwright.config.ts`：production preview、single worker、real-stack trace 与产物目录 owner。
- `deploy/scripts/e2e-local.sh`：唯一 PostgreSQL/Redis/API/Worker/storage/browser 生命周期和定向 spec 入口。
- `deploy/scripts/e2e-environment.py`：Redis allowlist cleanup 与固定端口释放证明。
- `backend/app/services/storage.py`：开发对象存储的限时签名 URL owner。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`：Workbench real-stack 分层、敏感失败输出和 cleanup 的文档证据。
- `.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-{aggregate-read-model,ui,e2e}/`：前三个 child Task 的规划、审计与已提交定向验证证据。

### 2. 测试分层结论：互补，没有第二套 Workbench 编排

| 层 | 精确证据 | 只负责 | 不重复负责 | 分类 | 级别 |
| --- | --- | --- | --- | --- | --- |
| Model | `workbench.model.test.ts:23-31,34-51` | generated union 穷尽映射、六类 count、服务端 href 原样保留、`null` 与合法 `0` 区分 | HTTP、DOM、PostgreSQL | Keep in Workbench Domain | P2 Keep |
| Component | `workbench-page.test.tsx:63-80,82-107` | 单 `GET /api/v1/workbench`、主要区块、empty/zero/null、fatal/retry | production build、键盘几何、真实业务状态 | Keep in Workbench Domain | P2 Keep |
| Backend integration | `test_workbench.py:137-198,202-203,422-480,483-549` | ADMIN/ENGINEER/anonymous、repeatable read、六类业务真值、current-tail rates、安全响应、top-10、固定 7 queries | 浏览器布局和 route navigation | Keep in Backend Read Model | P1 Keep |
| Strict fixture Playwright | `workbench.fixture.ts:88-127`; `workbench.spec.ts:3-59,61-86` | production artifact、只允许一个 Workbench business GET、未声明 API 失败、六类链接 passthrough、键盘、375/768/1024/1440、loading/error/retry/empty/zero/null | PostgreSQL 状态机和 backend 聚合口径 | Keep in Workbench Domain | P1 Keep |
| Real-stack | 四个 spec 的下述自然检查点 | 已有 UI mutation 后从真实 `/api/v1/workbench` 读取投影并沿服务端 href 回到既有 Workspace/Detail | 不再覆盖四档布局、未声明 API allowlist，不新建 Workbench mutation workflow | Keep in Workbench Domain | P1 Keep |
| Root E2E orchestration | `e2e-local.sh:81-180`; `e2e-isolation.md:22-40` | 独占资源、production preview、完整 V2 real-stack → V1 顺序、cleanup；根 `make e2e` 再运行 fixture suite（`Makefile:56-59`） | 单页面业务断言 | Keep in Backend Read Model | P1 Keep |
| Final gate | `Makefile:65-67` | 在固定候选上重新确认全部阶段和两套 Compose config | 不作为发现单个 Workbench bug 的循环 | Keep in Backend Read Model | P1 Keep |

四个 real-stack 文件没有新增 Workbench spec、fixture、helper、服务或 cleanup owner：

- Product Facts 只在原 Flow A 的 submit 后、approve 前插入 `/` 检查，并用 attention link 替换原 List detour；业务创建/保存/提交/批准仍属于原 flow（`product-facts-real-stack.spec.ts:130-164`）。
- Content Review 只在 `createReviewReadyTask` 已建立的待审核状态中插入 `/` 检查；批准与不可变版本断言继续由原 flow 持有（`content-review-real-stack.spec.ts:196-237`）。
- Publication 在同一 Flow A、同一 `workId/issueId` 的 PREPARING、AWAITING_VERIFICATION、OPEN issue 三个自然点读取 Workbench，然后继续原 lifecycle（`publication-workspace-real-stack.spec.ts:140-183,217-243,268-300`）。
- GEO 在同一 root/correction chain 前后读取 Workbench；问题数减一、attention 消失、`0/0 → null` 来自 tail 替换，不是第二套样本（`geo-real-stack.spec.ts:315-393,426-459`）。

因此 component、strict fixture、backend integration、real-stack 与最终 gate 的重复仅限少量跨层 smoke（单 GET、href 可见），是证明链的必要交接，不是重复业务编排。不要删除这些交接断言，也不要新建 `workbench-real-stack.spec.ts`。

### 3. 敏感信息与产物审计

#### EINF-01 — 限时对象存储签名会进入成功日志和 GEO 失败输出

- 严重级别：**P1**。
- 分类：**Confirmed defect requiring change**。
- 影响：`backend/app/services/storage.py:28-42` 将 `signature`、`expires` 和 operation 放在限时 URL query 中；`deploy/scripts/e2e-local.sh:105-107` 以 Uvicorn 默认 access log 启动开发对象存储。当前安装的 Uvicorn 0.51.0 在 `h11_impl.py:481-489` 使用 `get_path_with_query_string(scope)` 写 access log，因此每次成功 PUT/HEAD/GET 都可能把完整签名 URL写到终端/CI log。
- 同一 URL 还可能在 GEO 测试失败输出中暴露：`geo-real-stack.spec.ts:50-53` 的 `requestfailed` 保存完整 `request.url()`；`geo-real-stack.spec.ts:257-280` 直接比较两个完整签名 URL，matcher 失败时会打印 expected/received。
- 现有保护不足以覆盖此风险：real-stack 的 `trace: off`（`playwright.config.ts:23-26`）只关闭 trace；默认 video/screenshot 未启用，但不会清理 shell access log 或 assertion message。`secret-artifact.ts:18-23` 只扫描调用者明确传入的 secret 值，四个 Workbench real-stack owner 没有传入对象存储 signature sentinel。
- 建议最小修正：
  1. 在 `e2e-local.sh` 的开发对象存储 Uvicorn 命令增加原生 `--no-access-log`；不要建立自定义 logger/redaction framework。
  2. GEO 的 `requestfailed` 只记录 method + pathname；完整 URL 一致性改为不回显操作数的布尔断言，仍证明 transfer 使用 intent URL。
  3. 不修改 production storage 协议、签名算法、OpenAPI、数据库或其他 real-stack workflow。
- Required targeted check（实施阶段一次）：`bash -n deploy/scripts/e2e-local.sh`，随后复用最终 `make e2e` 验证真实上传与 cleanup；无需机械重跑四条已归档定向 Workbench命令。

#### EINF-02 — 08 文档把“安全设置”写成了比实际扫描范围更强的保证

- 严重级别：**P2**。
- 分类：**Simplify locally**。
- 证据：`docs/frontend-v2/08-testing-quality-and-acceptance.md:392` 要求失败输出不含 storage state/敏感信息，但 EINF-01 反证该陈述；父审计还把 `e2e-local.sh` 描述为 secret scan owner，而 `e2e-local.sh:1-181` 本身没有 artifact scan。Auth/System Admin specs 确有 `expectSecretsAbsent`，但四个定向 Workbench owner不拥有通用 secret scan。
- 建议：在本任务最终更新 08 时只写实际 owner：config 关闭 real-stack trace；Auth/System Admin 扫描已知 password sentinel；Workbench/Geo 通过 URL redaction 和无 access log 防止签名泄露。不要声称存在全局通用扫描，也不要复制 `secret-artifact.ts`。

#### 已确认安全的边界

- Workbench aggregate backend integration 用明确 sentinel 证明正文、summary、issue description、notes、legacy prompt/answer 不进入响应（`test_workbench.py:226-267,294-299,310-381,466-480`）。
- strict fixture 仅使用 synthetic user、CSRF、request ID 与 aggregate；真实凭据不进入 fixture，未声明业务 API 和 runtime error 在 teardown 失败（`workbench.fixture.ts:14-19,84-85,88-127`）。
- real-stack 统一 `fullyParallel: false`、single worker、list reporter，且 `PARTSIGNAL_E2E_REAL_STACK=1` 时 trace 关闭（`playwright.config.ts:7-26`）；未配置 video/screenshot，Playwright 1.61.1 默认不生成二者。
- `frontend-v2/.cache/playwright-results` 位于根 `.gitignore` 的 `.cache/` 规则下（`.gitignore:14`）；无 Workbench Task evidence 目录保存 trace/video/report。
- cleanup 仅输出数据库名、临时 storage path、Redis DB/key 数和固定端口，不输出 Redis URL、密码或 key 内容（`e2e-local.sh:53-79`; `e2e-environment.py:64-89`）。

### 4. 抽象、wrapper 与重复 glue

#### EINF-03 — 不新增 E2E orchestration/helper framework

- 严重级别：**P2**。
- 分类：**Promote only after proven consumers**。
- 证据：多个 real-stack spec 各有局部 `responseBody/login` glue，例如 Product `:30-40`、Content Review `:41-51`、Publication `:29-39`、GEO `:60-73`；仓库至少七个 real-stack spec 有同形 `responseBody`。它们不是 Workbench runtime owner，也没有造成第二服务/cache/source。
- 判断：本次不要为了消除十余行局部测试 glue 新增跨 spec framework或批量改七个既有 owner。若未来要统一“错误响应正文不得进入日志”的规则，应建立独立 test-maintenance Task，先冻结统一的脱敏错误合同，再迁移全部真实栈 consumer；不能只抽取一个薄转发 helper。

#### EINF-04 — 现有 `secret-artifact.ts` 保持共享，不创建 Workbench copy

- 严重级别：**P2 Keep**。
- 分类：**Keep in Design System/shared**。
- 证据：`secret-artifact.ts:1-27` 是纯测试产物扫描工具，已有 Auth/System Admin 多个真实 consumer；Workbench E2E Task 明确不复制它（归档 `design.md:47-54`）。
- 判断：需要新增已知 secret sentinel 时复用它；对象存储 URL 这类每次动态生成的 capability 优先从 log/assertion owner 阻止输出，不新增第二递归扫描器。

### 5. Canonical href 与覆盖范围

#### EINF-05 — 分层已证明“服务端提供、前端不重建”

- 严重级别：**P1 Keep**。
- 分类：**Keep in Backend Read Model**。
- 前端 model/component 使用任意 `?source=server` href 并原样输出（`workbench.model.test.ts:23-31`; `workbench-page.test.tsx:63-79`），证明没有 route/search 重建。
- strict fixture 用与真实后端不同的 synthetic href（`workbench.fixture.ts:27-63`; `workbench.spec.ts:17-33`），故它证明 passthrough 和 DOM，不冒充 backend canonical truth。
- real-stack 精确验证 Fact、Content、Publication PREPARING/verification/open issue 与 GEO PARTIAL/INCORRECT 的真实 count/item href（Product `:141-156`; Content `:204-217`; Publication `:167-183,219-235,270-286`; GEO `:368-393`）。
- backend integration 创建所有六类和 Publication 三个 action state，验证 count、标签、排序和安全响应（`test_workbench.py:272-303,422-480`）。

#### EINF-06 — Backend integration 对所有 exact href 的直接断言不完整

- 严重级别：**P2 residual test gap**。
- 分类：**Keep in Backend Read Model**。
- 证据：`test_workbench.py:431-436` 只检查 Fact href 后缀和三个 publication action label；没有在该 test 内逐一锁定所有 count link 与每类 attention direct href。真实栈补了当前 Phase 8 自然状态的主要组合，但没有单独经过 `PLATFORM_REVIEW`、`ACTION_REQUIRED` 的 Workbench navigation。
- 判断：当前服务实现、前端 passthrough 和主要 real-stack handoff 已形成足够证据，不应为此重复新建 browser flow。将其记录为 backend test coverage residual；只有审计 service 发现 href 漂移或未来下游 canonical search 合同变更时，才在现有 `test_workbench.py` 增加数据驱动的 exact href 断言，不新建 E2E spec。

### 6. 前三项 Task 已提交证据与“不机械重跑”清单

| 已归档 Task | 已提交定向证据 | 本任务规划阶段不再机械重跑 |
| --- | --- | --- |
| aggregate read model | `make contract-check`；定向 Ruff；backend mypy；`tests/integration/test_workbench.py` 3 passed、sparse/dense 固定 7 queries；V1/V2 api check；diff/task validate（归档 `implement.md:64-74`） | 同一组定向 Ruff/mypy/单文件 integration/api check |
| Workbench UI | model/page 2 files、6 tests；Workbench + Foundation fixture 两 project、6 tests；api check/typecheck/lint/build；diff/task validate（归档 `implement.md:128-140`） | 同一两个 Vitest 文件和两个 Playwright spec 的定向命令 |
| Workbench E2E | Product 4 passed、Content 2、Publication 3、GEO 2；四次 database/storage/Redis/port cleanup；lint/typecheck/diff/task validate（归档 `implement.md:42-79`） | 四条 `PARTSIGNAL_E2E_V2_SPEC=... deploy/scripts/e2e-local.sh` |

最终独立 `make test-integration`、`make test-unit`、`make e2e` 会包含上述测试，但其目的分别是全套交叉影响、根 E2E 顺序与 cleanup，而不是重复发现；这是 Phase Exit Gate 必要重验，不算机械定向重跑。

### 7. Required Validation、独立诊断与 final gate 归因规则

固定最终候选后，各安全阶段只运行一次，某阶段失败不阻止其余阶段：

```sh
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

归因矩阵：

| 失败阶段 | 第一 owner | 处理规则 |
| --- | --- | --- |
| contract-check | OpenAPI/generated types | 只修本任务实际引入的不一致；既有公共合同问题为独立 blocker |
| lint/typecheck | 报错文件所属 package | EINF-01 的 shell 变更不以 TS/Python workaround 掩盖；批量记录独立 owner |
| test-unit | 具体 unit/component owner | Workbench 只处理本任务最小修正造成的失败；不改测试放宽行为 |
| test-integration | backend/database owner | Workbench integration 失败若指向业务口径可阻塞 Phase 8；数据库/权限/既有状态机问题必须独立 Task |
| build | backend/V1/V2 artifact owner | 保留三套 build 结果，不用单包成功替代根 build |
| e2e | 先分 V2 real-stack、V1、V2 fixture，再核对 cleanup | Workbench 检查点失败归对应现有 workflow owner；cleanup/access-log 修正归 infra；一个 suite 失败仍记录已安全完成的其他阶段 |
| Compose dev/prod config | deploy owner | 配置错误不归到 Workbench UI；不通过跳过 config 宣称 MET |

只有九个独立阶段全部通过、候选合理预期成功时才运行一次：

```sh
make verify
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-workbench-abstraction-review
git status --short --branch
```

`make verify` 的实际 fail-fast 顺序由 `Makefile:65-67` 固定为 contract → lint → typecheck → unit → integration → build → e2e → dev/prod Compose。若最终 gate 意外失败：

1. 不重跑相同失败命令；先确认是否还有未执行且安全的独立阶段。
2. 对尚未有本候选独立证据的阶段各跑一次，批量列出 authoritative owner、是否与本任务 diff 相关、是否环境问题。
3. 任一 required stage 非零、cleanup 未完整、出现敏感输出、或发现 P0/P1 未关闭，Phase 8 Exit Gate=`NOT_MET`。
4. 不在本任务中创建“一 blocker、一重跑”循环；数据库、权限、既有状态机、公共合同或跨 domain 问题必须成为独立 Task，全部关闭后再规划纯 recheck。

### 8. P0/P1/P2 摘要与 Exit Gate 影响

| 级别 | 数量 | Finding | Gate 影响 |
| --- | ---: | --- | --- |
| P0 | 0 | 无数据损坏、认证绕过或第二业务 owner 证据 | 无 |
| P1 | 1 | EINF-01：对象存储签名 URL 会进入 access log/失败输出 | 未修复前 Phase 8 必须 `NOT_MET`；属于本任务可完成的最小局部修正，不需独立 blocker |
| P2 | 3 | EINF-02 文档保证过强；EINF-03 spec-local glue 暂不抽象；EINF-06 exact href backend test residual | EINF-02 随最终 08 更新修正；EINF-03/EINF-06 不阻塞，不扩围 |

当前未发现需要数据库、权限、既有状态机或公共合同修改的独立 blocker。EINF-01 只涉及 `deploy/scripts/e2e-local.sh` 与 `geo-real-stack.spec.ts` 的日志/断言边界，属于本 Task 的最小修正。

## External References

- 本地锁定 Uvicorn：0.51.0；CLI 明确支持原生 `--no-access-log`，无需自定义 logging dependency。
- 本地锁定 Playwright Test：1.61.1；当前 config 显式设置 trace，video/screenshot 保持 Playwright 默认关闭。
- 未使用互联网资料；结论来自锁定依赖源码、CLI 与仓库实现。

## Related Specs

- `.trellis/spec/frontend/quality-guidelines.md:96-106,121-157`：真实浏览器、production artifact、real-stack trace 与根质量入口。
- `.trellis/spec/infra/e2e-isolation.md:20-40,42-78`：定向 spec、独占数据库/Redis/storage、真实栈顺序和 cleanup。
- `.trellis/spec/infra/ci-execution.md:19-28,49-56`：根 E2E/verify 与手动 CI owner。
- `.trellis/spec/frontend/state-management.md:19-38`：服务端 state/query owner 与禁止全局第二来源。
- Phase 8 父任务 `design.md:126-134`：backend/component/strict/real-stack/review 五层职责矩阵。
- Phase 8 父任务 `implement.md:134-176`：第四 child 的独立诊断、final gate 与 NOT_MET 规则。

## Caveats / Not Found

- 本研究没有运行任何测试或完整 gate；所有“passed”数字只引用三个已归档 Task 的实际执行证据，不冒充本候选结果。
- 未发现前三个 Workbench Task 的独立 `evidence/` 日志目录；执行证据持久化在各自 `implement.md`、`prd.md` 与归档 task metadata 中。
- 未检查或修改 V1 Dashboard 产品实现；仅确认根 `make e2e` 仍保留 V1 owner。
- EINF-01 是源码可达的泄漏路径；尚未在本研究中主动生成并捕获真实签名日志，因为那会把敏感 capability 再次写入研究输出。
- 本研究不修改产品代码、合同、spec、docs 或已归档 Task 历史。
