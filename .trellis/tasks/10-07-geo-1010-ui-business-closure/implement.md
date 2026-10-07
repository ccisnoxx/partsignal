# GEO-1010-UI 实施与验证记录

## 启动状态与授权

2026-10-07 按本会话用户授权，仅实施 UI 核心闭环。开始前读取根/前端 AGENTS、当前 task-manifest、GEO-1010 parent 与 UI brief、required_docs、范围/验收/范围外，以及现有 evaluate/Action/Retest API、Opportunity/Run/Plan 页面和真实栈 spec 的 API 编排步骤。

- 基线：main `bc68f087153009aae032e52415ee5c9274199581`，初始工作树 clean。未执行 fetch、commit、push；该基线不是本次未提交候选冻结。
- GEO-1009 done；GEO-1006、704、705、706、707 均 done，manifest 人工接受历史保留。旧 SHA 门禁不用于证明本次 UI。
- UI 初始 ready；开始后 in_progress，parent 同步 in_progress。UI实施结束进入review时，DEPLOY/UAT仍为planned、implementation_started=false，尚未修改其task文件；后续人工接受与移交见文末。
- 已先输出 API/UI 差距、页面流程、计划文件、OpenAPI 判断、测试与范围外，随后实施。

## 结果与 API 判断

复用现有 evaluate、Content Task Action、Retest preview/create、comparison/resolve/continue；无重复 API、OpenAPI/generated/schema/DDL/Alembic/历史回填变化。局部设计见 design.md。

1. ADMIN 机会工作台显式评估：UTC 半开窗口≤31天、规则 revision、ALL/FILTERED、Subject/产品关联、Surface/Profile 分页选择、Collection Mode。显示冻结回执和 created/reused/skipped/unavailable 原因。ENGINEER 不渲染入口或读取评估选项。
2. Opportunity 详情创建 Content Task：只消费现有原子 creation-options，搜索产品/平台并选择已批准 FactVersion，来源/revision/三个ID可核对。更换产品清除依赖事实；创建后提供目标链接，保持事实审核和人工发布。
3. Retest：选择来源页真实 batch 或明确 UUID，展示 comparable/differences/requires_new_baseline/完整冻结矩阵。不可比禁止 create，不换基线；可比后显式确认，跳转新批次并写入 retest_batch_id，接入既有比较和显式 resolve/continue。行动完成或恢复不自动解决，变化不证明因果。
4. UI 消费服务端动作投影；发现既有 policy 从未返回 ADDITIONAL_MONITORING，遂在已有角色/活动/改密门禁和 IN_PROGRESS 后返回该已有 token。它只允许尝试 preview，具体来源、环境、资格仍由原 preview/create 重验。ACKNOWLEDGED 不返回该 token；无新领域规则。
5. loading/empty/error/权限与 revision 冲突沿现有组件合同。409 保留输入、显式重读再确认；Retest 需重新 preview。网络/5xx/异常成功回执冻结 payload/key，仅显式恢复原请求。主体/卸载隔离迟到响应，DirtyGuard 提示离开会丢失请求身份。
6. 真实栈 spec 的 evaluate、Content Task Action、Retest preview/create 改为页面操作。setup/只读断言可用 API。删除唯一被替代的 geo_loop_e2e_seed 及前端调用。仅隔离 E2E 栈开启显式 evaluator，无自动周期注册；390px 下新表单和矩阵未撑宽文档；截图检查发现fieldset默认最小宽度使长FactVersion控件被裁切，直接控件边界断言失败后，局部fieldset min-w-0与SelectTrigger/Value宽度约束修正。失败日志real-stack-e2e-fieldset-width-failed.log保留。

## 实际验证

| 检查 | 实际结果 / 原始证据 | 边界 |
|---|---|---|
| npm --prefix frontend run test | 142文件、1342测试通过；evidence/frontend-unit.log | 全前端单元在初版候选执行；复核修正后仅重跑受影响域，其余证据复用 |
| npm --prefix frontend run test -- src/domains/geo-opportunities | 最终9文件、79测试通过；evidence/opportunities-tests-final.log | 新表单及原比较/决定组件、模型；包含5项先失败后通过的复核回归 |
| npm --prefix frontend run typecheck | 退出0；evidence/typecheck-final.log | 前端代码/测试与generated契约 |
| 定向 ESLint --max-warnings 0 | 退出0、无warning；evidence/frontend-lint.log | Opportunity域/route和两个真实栈文件 |
| pytest backend/tests/unit/test_geo_opportunity_actions.py -q | 16通过；evidence/backend-projection-tests.log | 动作投影精确状态/角色/改密边界 |
| ruff check 两个改动后端文件 | 退出0；evidence/backend-lint.log | 改动服务/单元文件 |
| mypy --config-file backend/pyproject.toml backend/app/services/geo_opportunity_policy.py | 退出0；evidence/backend-typecheck.log | 投影服务及必要依赖 |
| make contract-check | 退出0；evidence/contract-check.log | FastAPI/OpenAPI完整契约与generated一致 |
| 目标真实栈 Playwright | 最终候选1passed（1.1m）、playwright=0、secret_scan=0/clean；evidence/real-stack-e2e.log | 独占随机PG数据库、Redis DB13、真实API/Worker/Beat、production frontend build、本地存储/AI替身，foundation-desktop一个journey |

真实栈命令：`PARTSIGNAL_E2E_SPEC=tests/e2e/geo-loop-real-stack.spec.ts deploy/scripts/e2e-local.sh`。运行前通过 Compose 配置的捕获输出解析既有本地 PG 连接，只在子进程环境覆盖127.0.0.1:55432；Redis为127.0.0.1:56379/13，不输出私有配置或凭据。canonical 入口完成独占资源预检、schema0066前滚、构建、敏感产物扫描与精确测试资源清理。此前停止的本地 postgres/redis 为该测试启动；最终清理确认无其他PG客户端、Redis只有本次INFO客户端，收尾恢复停止状态。

## 失败诊断与独立复核

- 首轮组件测试同步寻找 portal option 失败，改为等待真实异步选项；生产选择组件不变。初版类型检查的 Subject union、mock 泛型调用记录与 E2E 字段错误已修正；form.watch lint 警告改用 useWatch。最终相关检查通过。
- 首轮真实栈用错误 searchbox 选择器寻找 Content Task 文本框，定位后主动终止，退出130；原始日志保留 real-stack-e2e-selector-interrupted.log。改用 textbox，并对齐成功 Run 链接；下一轮真实闭环通过。
- 独立只读复核确认1项P1、2项P2：详情403后新表单保留旧数据、成功HTTP缺失评估回执丢key、Retest迟到URL回调覆盖新来源页。4项回归先失败（detail-denied-before.log、review-regressions-before.log）；最小修复为统一详情权限边界、仅4xx释放命令、当前导航ref。修复后79项定向通过。第二位fresh只读审查确认原三项已修复，并指出后选比较批次仍会被迟到结果覆盖；补充回归先失败后通过（compare-intent-before.log），创建成功仅在比较选择身份未变化时自动切换。最后一项P2由主代理与直接反例测试验证，未声称第三轮独立批准。窄屏fieldset/Select局部修正后最终真实栈通过，控件右边界与文档宽度均符合390px约束。详见independent-review.md。
- 子代理审计 bundle：20261007T154700Z-geo-1010-ui-596fb434；3次执行（实现1、只读复核2）的digest及audit-finalize/audit-verify通过，Bundle已关闭；模型/推理档位为Agent TOML配置证据，非运行时遥测。

## 范围与剩余义务

未实施 Browser Adapter/API采集/CRON/自动Opportunity调度/Opportunity CSV/公共重分析/自动发布/无关安全强化/全站重构/其他Action创建页面。backend增量仅已有Retest动作投影；deploy脚本增量仅隔离test入口，不部署。

本地替身与虚构观测只证明实现闭环；未运行同候选make verify、完整集成/全E2E/浏览器矩阵、现场真实服务、部署/恢复、120～180真实Run、性能/UAT、内部Go/No-Go或生产Go。这些不是UI完成证据，按父任务留给DEPLOY/UAT。

## 工作验收与人工接受

实现、相关验证和复核修正完成后，UI先进入 review；此前无人工接受记录，未自行 done 或启动 DEPLOY。

最终静态收尾：sh -n deploy/scripts/e2e-local.sh、git diff --check、文档SHA256SUMS及本任务/父子状态核对通过；未执行Git提交/推送。

2026-10-07T16:52:04Z，当前会话用户明确指示“人工接受并标记 done ，然后再开启 DEPLOY 会话”。依据该人工指令，将 UI 从 review 更新为 done；[人工接受记录](../../../docs/geo-monitoring/06-reviews/2026-10-07-geo-1010-ui-acceptance.md)与 [机器记录](./acceptance.json)保存接受范围、现有证据和未提交状态。原 evidence/final-state.json 保留 review 时的历史快照，不回写历史。此次仅更新治理记录，复用仍有效的应用验证，不重复运行测试。

GEO-1009/UI 均 done，DEPLOY 依赖满足并获新会话启动授权，转为 ready。具体部署仍须闭合其 brief 中的候选、目标/阶段、身份和恢复输入；UAT 保持 planned，父任务保持 in_progress。该接受不代表同候选完整门禁、候选冻结、内部部署或生产 Go。
