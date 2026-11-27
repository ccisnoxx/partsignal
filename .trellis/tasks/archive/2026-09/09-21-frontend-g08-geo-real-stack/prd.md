# G08 GEO 真实业务闭环

## Goal

在当前隔离 PostgreSQL、Redis、FastAPI、对象存储和 V2 production preview 上验收 GEO 业务闭环，并复核 GEO domain 的状态与证据归属。

## Requirements

- 前置 G02–G07 已按本轮证据完成。依据 `docs/frontend-v2/11-frontend-redevelopment-task-list.md` G08、`08-testing-quality-and-acceptance.md` §13.10 和 GEO 合同；历史 V2 记录只作为测试设计，不计本轮结果。
- 复用 `deploy/scripts/e2e-local.sh` 的唯一隔离生命周期；不得导入 fixture、拦截业务 API、共享开发数据库或另建测试编排。完成后确认数据库、对象存储、进程和独占 Redis 绑定清理。
- Flow A 由 V2 New 页面创建真实 evidence 的 root Observation，经 Detail 服务端动作进入 Correction Workspace，追加第二份 evidence；Detail/List 与最终 API 证明 root 不可变、直接证据与祖先证据分离、`supersedes_id` 正确且列表只投影当前尾。
- Flow B 以 API 建立确定性的两周期前置，从 V2 Insights `CONTENT_DECLINE` 读取按需 options、单次幂等 POST 创建 Optimization ContentTask；Task Detail UI/API 证明 Product、Platform、Fact 与冻结 GEO source snapshot。
- Topics 与 Insights 的关键跳转和错误边界用 G05/G06 当前严格 fixture 和 G08 当前真实业务链合并验收；若真实栈发现缺口，在权威 owner 修复并定向复验。

## Acceptance Criteria

- [x] 当前隔离真实栈 Flow A/B 通过，记录实际断言数量、进程/DB/存储清理与任何环境限制。
- [x] GEO domain 状态、证据、来源和缓存边界经实际代码/测试复核；修改则做所需定向测试与独立高风险复核。
- [x] 记录实际代码、当前验收、未覆盖边界及后继 A/S 或 W/I 任务，检查 diff 和工作树。

## Notes

- 本轮只做本地验收，不执行发布、提交或远端写入。

## 本轮实施与验证证据

- 初次 `deploy/scripts/e2e-local.sh` 指向 `geo-real-stack.spec.ts` 为 **0/2**：Flow A 固定 `2026-08-12/13` 已脱离服务端“UTC 今日及前 29 日”窗口，Workbench 计数真实返回 0；Flow B Task Detail 已显示中文“GEO 优化”，旧英文标题断言失败。两项均诊断为测试期望漂移，未改服务端窗口或放宽业务/快照断言。
- 实际代码仅改 `frontend/tests/e2e/geo-real-stack.spec.ts`：Flow A 用浏览器时区的本轮时刻前 2/1 天填 `datetime-local`，保持 root 早于 correction 且位于当前窗口；Flow B 精确断言当前中文标题。原有 root 不可变、祖先与 direct evidence、当前尾、Workbench count/rates 和 GEO source snapshot 的断言均保留。
- 修改后同一隔离真实栈 **2/2**（Flow A 3.9s、Flow B 1.0s），全脚本退出码 0；脚本输出确认 Redis DB 14 本次 binding key 删除、8000/9001/4174/19009 端口释放、临时 PostgreSQL 数据库 dropped、对象存储目录 removed。`npm run typecheck`、该 spec 定向 ESLint 与 `git diff --check` 均通过；真实栈构建了当前 production artifact。
- 独立只读复核已检查当前测试 diff、时区/30 日边界和保留的完整断言，没有确认阻断问题；本轮未专门测试窗口边界或完整时区矩阵。G01–G06 的页面与命令状态审计、G08 真实链路共同覆盖 GEO 状态/证据 owner；服务端始终为持久化与资格权威。
- 本项实际 diff 仅上述测试文件，`git diff --check` 无问题；工作树其余修改属于之前已记录的 F/P/C/U/G 子任务，未清理或覆盖。G08 不将历史 12 passed 或严格 fixture 当成本轮真实栈结果；下一批按清单进入 A/S 配置与系统页，再按前置执行 W01/I01–I03。
