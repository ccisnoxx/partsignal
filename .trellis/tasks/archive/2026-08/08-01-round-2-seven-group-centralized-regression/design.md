# 第二轮七组修复集中回归：测试设计

## 1. 设计结论

复用项目现有门禁、现有组件/集成/E2E 测试以及第二轮报告的最短复现步骤，不创建新测试框架。集中回归以“缺陷 ID → 修复提交 → 权威合同 → 自动化证据 → 必要浏览器/环境证据”为单一矩阵；原归档报告保持历史不可变。

任务只写 Trellis 任务资料、`research/regression-matrix.md` 和 `report.md`。如果现有门禁无法证明某项关闭，可增加任务目录内的最小一次性证据记录，但不修改现有测试或产品代码。

## 2. 判定优先级

1. `contracts/openapi.yaml`：API 字段、命令和错误合同。
2. `contracts/database.md`：状态、删除守卫、历史保留和数据库不变量。
3. 当前后端服务投影/命令守卫、前端生成类型和消费者。
4. `.trellis/spec/backend/available-actions-contract.md`、前端交互规范和开发对象存储运行契约。
5. 三份活动设计/验收文档。
6. 原第二轮报告和八个修复任务：只提供缺陷定义、修复边界与复现步骤，不覆盖本轮运行结果。

来源冲突时记录 `FAIL` 或决策漂移，不选择更容易通过的解释。

## 3. 覆盖矩阵

| 分组 | ID / 决策 | 权威实现与测试所有者 | 集中回归证据 |
| --- | --- | --- | --- |
| 动作投影 | `PS-QA2-FUNC-001`～`003`、`PS-QA2-DEC-002` | `backend/app/services/projections.py`、各领域 service/presenter、OpenAPI、前端 feature 消费者及现有单元/集成测试 | 合同检查、后端单元/集成、前端组件、全量 E2E；定向复测终态任务、已解决异常和非链尾更正页 |
| 删除并发 | `PS-QA2-DELETE-001` | `backend/app/services/ai_configuration.py`、`backend/tests/integration/test_ai_channel_management.py` | PostgreSQL 并发集成断言 `204/404`、单一成功审计、单次失效副作用 |
| 焦点恢复 | `PS-QA-201`、`PS-QA2-UI-002` | `useFocusReturn`、发布工作台/抽屉、审计页及组件/E2E 测试 | 组件测试 + 真实键盘链；关闭后精确比较原触发器，不接受“不是 BODY”作为唯一证据 |
| 危险说明 | `PS-QA-202`、`PS-QA-203` | 六个页面确认框、五个现有 feature 测试、服务端删除副作用 | 组件断言、目标源码术语扫描、真实确认框抽样；不执行额外破坏性删除 |
| 资源兼容 | `PS-QA2-UI-001`、`PS-QA2-UI-003` | `index.html`、`public/favicon.svg`、生产资产门禁、发布详情及测试 | 构建资产门禁、登录页 network/console、发布详情 Timeline console |
| 24 表门禁 | `PS-QA2-TEST-001` | `cross-page-visual-convergence.spec.ts`、`shared-data.setup.ts` | 隔离 E2E 中 24 项双视口逐目标通过；静态复核唯一 region 和 dialog scope，背景表不参与替代 |
| 对象存储 | `PS-QA2-ENV-001` | `compose.dev.yaml`、开发存储协议测试、共享开发 API/浏览器 | Compose 构建与日志、单元测试、唯一对象真实 PUT/HEAD/GET/DELETE、浏览器请求与精确清理 |
| 文档同步 | `PS-QA2-DEC-001` | 三份活动文档、`0033` 迁移、数据库合同、删除服务与集成测试 | 旧口径清零、正向条款交叉核对；不修改归档历史 |

## 4. 执行层次

### 4.1 静态与自动化层

- 冻结当前代码、迁移和环境后，运行项目七项门禁；完整套件负责证明跨层合同、生成类型、共享模块和现有 E2E 没有整体回退。
- 从套件结果中单独登记与各缺陷对应的测试文件/测试名，不能只写“全量通过”。
- 对 `available_actions` 消费者、危险术语、Timeline 旧字段、favicon 资产和文档旧口径做定向静态扫描。
- 隔离 E2E 使用共享 Redis 的独立数据库编号，并在运行前识别 `5173` 等端口所有者；只临时停止确认为开发栈且与 E2E 冲突的服务，结束后恢复原状态，不触碰 staging。

### 4.2 真实浏览器层

- 使用项目 `playwright-cli` 命名临时会话，复测自动化不能充分证明的交互：Dropdown→确认、发布抽屉、桌面/移动审计详情、登录 favicon、发布 Timeline console，以及共享开发新对象请求。
- 使用 `1440×1000`、`375×900` 两个主视口；24 表几何由现有隔离 E2E 负责，不重复制作截图巡检。
- 焦点通过条件是 `document.activeElement` 精确等于打开浮层的原触发器；关闭后只要“不在 BODY”仍不足以判定通过。
- 浏览器证据不保存认证状态，不把 Cookie、Token、敏感 Header 或业务正文写入报告。

### 4.3 共享对象存储层

- 当前 `19001` 属于范围外 staging。执行前先确认端口所有者；继续占用时，使用不落盘 Compose `!override` 将开发 `fake-oss` 临时发布到空闲端口，并为本轮开发 API 临时覆盖 `OBJECT_STORAGE_PUBLIC_ENDPOINT`，内部端点继续使用 `http://fake-oss:9000`。
- 不停止 staging，不修改 `.env` 或 Compose 文件。验证结束后移除本轮开发 `fake-oss`/临时覆盖，并按执行前状态恢复开发 API，只清理本轮唯一对象和关联记录。
- 新对象真实文件链通过即可证明启动修复；共享数据库中既有而共享卷缺失的历史对象仍按已有所有权边界单列，不伪造数据。

## 5. 结果与停止规则

- 每个矩阵项使用 `PASS/FAIL/BLOCKED/NOT_APPLICABLE`；环境阻断复现一次并取得日志后停止重复运行，继续独立模块。
- 出现越权写入、秘密泄露、受保护历史变化或跨环境串扰时，立即停止对应写路径并保留证据。
- 自动化或浏览器失败先归因；没有代码、配置或环境变化时不重复同一失败。
- 新缺陷只写入 `report.md` 和后续任务建议，不修改业务实现或现有测试。

## 6. 数据、清理与回滚

- 隔离 E2E 继续由 `deploy/scripts/e2e-local.sh` 创建 allowlist 数据库和 `mktemp` 存储，并以 `E2E_CLEANUP ... status=deleted` 作为清理证据。
- 共享 smoke 使用包含 `run-id` 的唯一对象，只清理本轮所有对象；禁止前缀模糊清扫共享库或共享卷。
- 任务不改变产品状态，因此无代码回滚；若发现缺陷，保持当前实现并转独立任务。
- `.playwright-cli/` 与 `frontend/.playwright-cli/` 既有产物保持原状，不进入差异、报告附件或提交。

## 7. 产物边界

- `.trellis/tasks/08-01-round-2-seven-group-centralized-regression/{task.json,prd.md,design.md,implement.md}`
- `.trellis/tasks/08-01-round-2-seven-group-centralized-regression/research/regression-matrix.md`
- `.trellis/tasks/08-01-round-2-seven-group-centralized-regression/report.md`

不更新原第二轮归档资料、活动代码/测试/合同/文档或长期自动化资产。
