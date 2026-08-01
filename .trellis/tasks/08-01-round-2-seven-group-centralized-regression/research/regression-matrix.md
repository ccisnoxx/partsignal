# 第二轮修复集中回归矩阵

## 1. 运行基线

- run-id：`R2-FIX-CLOSURE-20260801-01`
- 冻结时间：`2026-08-01 19:44:33 CST`
- 分支：`main`
- 冻结提交：`97163c4dc2ba601d2bb54893fb8dca9ccc54415f`
- Alembic head/current：`0033_task_owned_history_delete`
- Python：系统 `3.9.6`；后端虚拟环境 `3.12.13`
- Node / npm：`v24.16.0` / `11.13.0`
- uv / Playwright：`0.11.19` / `1.61.1`
- 八个工作提交：`5808545`、`62c4e16`、`2e59943`、`95b34bc`、`6c45c09`、`f491809`、`6f8ca05`、`fab7e9c` 均为冻结提交祖先。
- 开发栈：PostgreSQL、Redis、API、Worker、Scheduler、前端均运行；开发 `fake-oss` 未运行。`5173` 为开发前端，`19001` 为范围外 staging `fake-oss`。
- 首次宿主机 `alembic current` 使用 `.env` 的容器内主机名 `postgres` 无法解析；改用同一数据库的宿主机映射 `127.0.0.1:55432` 后确认 current=head。该失败属于命令环境选择，不是迁移失败。

## 2. 状态定义

- `PASS`：本轮独立证据满足当前合同和验收标准。
- `FAIL`：本轮证据确认行为、门禁或文档仍不满足预期。
- `BLOCKED`：当前环境阻止取得结论，且已有可复现证据。
- `NOT_APPLICABLE`：合同明确不适用。

本轮没有核心 `BLOCKED` 或未执行项；最终结论由已确认的 `FAIL` 决定。

## 3. 自动化门禁

| 编号 | 检查 | 状态 | 本轮结果/证据 |
| --- | --- | --- | --- |
| `GATE-001` | `make contract-check` | `PASS` | OpenAPI/FastAPI 递归语义检查和生成 TypeScript 合同通过，`1.50s`。 |
| `GATE-002` | `make test-unit` | `PASS` | 后端 `141 passed`；前端 `26` 文件、`184 passed`；生产资产 Node 测试 `24 passed`；总耗时 `258.33s`。jsdom CSS/navigation 输出为既有非失败诊断。 |
| `GATE-003` | `make test-integration` | `PASS` | PostgreSQL 集成 `70 passed in 90.53s`，实际 `92.37s`。 |
| `GATE-004` | `make e2e` | `FAIL` | `44 passed, 8 failed`，约 `4.8m`，实际 `296.31s`。24 表和 200% 缩放用例通过；失败由三组旧测试资产漂移构成：6 个 compatibility/Trusted Types 跨浏览器 mock 缺必填 `available_actions`，1 个 MVP 流程仍期待未配置自然化 Prompt 时按钮可用，1 个 Dashboard 截图基线落后当前已提交页面。 |
| `GATE-005` | `make lint` | `PASS` | 后端/前端 lint 通过，`3.92s`。 |
| `GATE-006` | `make typecheck` | `PASS` | mypy `68` 个源文件与前端 TypeScript 通过，`3.20s`。 |
| `GATE-007` | `make build` | `PASS` | 后端/前端镜像、Vite `4933` modules 和生产资产门禁通过，`35.56s`；仅有旧 Docker builder 提示。 |

补充定向验证：AI 配置并发删除用例通过，实际 `2.92s`；开发对象存储单元测试 `6 passed`。

### `GATE-004` 失败归因

1. `compatibility.spec.ts` 的 Chromium/Firefox/WebKit 三项 mock Product 缺少已批准合同要求的 `available_actions`，页面消费者调用 `.includes(...)` 后无法完成后续兼容断言。
2. `trusted-types.spec.ts` 的 Chromium/Firefox/WebKit 三项 mock User/Product/ProductFacts 同样没有同步 required `available_actions`，`TT-001` 页面未渲染。当前合同检查与真实 API 响应均要求字段存在，不应在产品代码增加默认值兼容旧 fixture。
3. `mvp-flow.spec.ts:503` 在全局自然化 Prompt 尚未配置时仍断言“自然化”可用；当前服务端仅在 Prompt 已配置时投影 `CREATE_HUMANIZATION_JOB`，测试期待与批准后的合同相反。
4. `dashboard-light-1440x1000.png` 与当前 Dashboard 相差 `118054` 像素（比例 `0.09`）。当前页面包含文章发现/提及/准确率和“发布管理”，基线仍保存旧指标与“人工发布”；这是提交 `406f3ab` 之后未同步的测试资产。

没有代码、配置或环境变化可以影响这四个共同根因，因此按停止规则没有重复运行完整 E2E。

## 4. 原问题与决策闭环

| ID | 修复提交 | 状态 | 本轮证据 |
| --- | --- | --- | --- |
| `PS-QA2-FUNC-001` | `2e59943` | `PASS` | 组件用同状态、不同 `available_actions` 只呈现一个 `RETRY`；共享开发真实 `COMPLETED` 任务含 2 个失败作业、API 动作为 `[]`，页面“重试原快照”按钮为 `0`。 |
| `PS-QA2-FUNC-002` | `2e59943` | `PASS` | 组件断言无 `CREATE_REPAIR_TASK` 时只读；共享开发已解决异常 API 动作为 `[]`，修复直达页显示只读提示，表单和创建按钮均为 `0`。 |
| `PS-QA2-FUNC-003` | `2e59943` | `PASS` | 集成测试确认只有链尾投影 `CORRECT`；共享开发非链尾记录动作为 `[]`，真实更正页提示“当前记录不可更正”，备注、文件选择和提交均禁用。 |
| `PS-QA2-DELETE-001` | `5808545` | `PASS` | 定向 PostgreSQL 并发用例同时覆盖渠道/Header：状态为单一 `204` 和落后 `404`，单一成功审计、单次失效/版本副作用。 |
| `PS-QA-201` | `95b34bc` | `PASS` | Dropdown→“取消待发布候选”确认框选择“返回”后，焦点精确回到原“更多操作”按钮；Hook/组件测试同时通过。 |
| `PS-QA2-UI-002` | `95b34bc` | `FAIL` | 审计桌面侧栏与移动 Drawer 均精确恢复触发器；发布候选抽屉无 dirty 状态直接关闭后，焦点落到 `BODY`。`PublicationWorkspace` 清空 query 后以 `closed:view` key 立即替换 Drawer，旧实例来不及在 `afterOpenChange(false)` 调用 `restoreFocus`。现有组件测试只覆盖 dirty→确认放弃链，未覆盖直接关闭。 |
| `PS-QA-202` | `6c45c09` | `PASS` | 五个 feature 测试通过；六个目标页面的用户可见“物理删除”扫描为 0；真实 AI Header 确认框使用业务影响说明。 |
| `PS-QA-203` | `6c45c09` | `PASS` | Header 确认框明确说明停用渠道和全部模型、重置为未测试、清除最近测试信息、重新测试并启用前不可生成，与后端失效逻辑一致。 |
| `PS-QA2-UI-001` | `f491809` | `PASS` | 生产资产门禁通过；匿名登录页只声明并请求 `/favicon.svg`，HTTP `200`，未请求 `/favicon.ico`。 |
| `PS-QA2-UI-003` | `f491809` | `PASS` | Timeline 使用 `items.content`；组件测试通过，真实发布详情“状态轨迹”加载后 console 无目标 `items.children` 弃用警告。 |
| `PS-QA2-TEST-001` | `6f8ca05` | `PASS` | 清单为 `24` 项且 `24` 个唯一 `regionLabel`；2 项带精确 `dialogName`；locator 在 dialog/page scope 内结合 `.table-region`、精确 role 和 `toHaveCount(1)`。完整 E2E 中 24 表双视口用例通过。 |
| `PS-QA2-ENV-001` | `62c4e16` | `PASS` | 临时开发 `fake-oss` 映射 `19002`，staging `19001` 保持运行；浏览器 PUT `204`、API complete `200/VERIFIED`、签名 GET `200` 且 47 字节一致。日志无 `uv run`/PyPI/依赖同步，两个本轮记录均清为 `DELETED`、对象为 `MISSING`。 |
| `PS-QA2-DEC-001` | `fab7e9c` | `PASS` | 三份活动文档的六类旧删除口径扫描为 0；当前条款与数据库合同、`0033`、删除 service 和 PostgreSQL 集成测试一致。 |
| `PS-QA2-DEC-002` | `2e59943` | `PASS` | OpenAPI/生成类型/稳定 spec 通过；前端现有资源消费者有 `66` 处 `.available_actions.includes`。从该提交到冻结提交的生产差异只增加焦点触发器传递，未恢复角色/状态资格旁路；E2E 失败反而证明旧 fixture 必须跟随 required 合同更新。 |

## 5. 相关操作列与 24 表

| 分组 | 状态 | 本轮结果 |
| --- | --- | --- |
| 资源命令操作列 | `PASS` | 用户、产品/事实、平台/Prompt、AI、账号、任务/作业/版本、发布和 GEO 的既有命令继续消费资源自身 `available_actions`；集合创建、导航/查看/复制/筛选/导出/打印、认证自服务和文件传输内部动作保持批准的排除边界。 |
| 24 表唯一目标 | `PASS` | `24/24` 项、`24/24` 唯一 region；“产品文章观测结果”限定“登记人工观测” dialog，“远端模型列表”限定“获取模型” dialog。 |
| 24 表桌面/移动 | `PASS` | 完整 E2E 的“全站 24 张业务表”用例在 `1440×1000` 与 `375×900` 通过；相关 200% 浏览器缩放用例也通过。 |

## 6. 新发现与分流

| 新发现 | 影响 | 建议独立任务 |
| --- | --- | --- |
| 发布抽屉直接关闭焦点仍丢失 | 原 `PS-QA2-UI-002` 未真正闭环，键盘用户回到文档根节点 | `08-01-publication-drawer-direct-close-focus-restoration`：只改发布抽屉生命周期/测试，不并入 E2E 资产修复 |
| E2E `available_actions` fixture/期待落后合同 | 6 个跨浏览器用例和 1 个 MVP 流程误报；当前 required 合同本身通过 | `08-01-e2e-available-actions-contract-sync`：同步 compatibility、Trusted Types mock 和 MVP 自然化期待，不给产品代码加兼容默认值 |
| Dashboard 视觉基线落后当前已提交 UI | 全量 E2E 保持红色，无法作为发布门禁 | `08-01-dashboard-visual-baseline-sync`：先人工确认当前 Dashboard 为预期，再只更新对应基线 |
| Ant Design `Alert.message` 弃用警告 | 已解决异常修复页真实 console 出现警告；源码仍有 10 处相同属性 | `08-01-antd-alert-content-prop-compatibility-cleanup`：独立前端兼容清理，统一改为当前 `title` 属性并定向验证 |

## 7. 清理与任务范围

| 检查 | 状态 | 本轮结果 |
| --- | --- | --- |
| 隔离 E2E 数据库与临时存储精确删除 | `PASS` | 本轮数据库 `partsignal_e2e_20260801_95715` 和临时存储 `partsignal-e2e-storage.QwWZKD` 已删除；共享库中既有 `partsignal_e2e_stage3`、`partsignal_e2e_table_display` 不属于本轮，保持不动。 |
| 共享对象存储唯一对象和临时开发服务精确清理 | `PASS` | 两条本轮文件记录保留 `DELETED` 墓碑，对象均缺失；开发 `fake-oss`/19002 已移除，开发 API 恢复 `http://localhost:19001` 原配置，staging 19001 未停止。 |
| 命名浏览器会话和任务认证状态清理 | `PASS` | `r2-centralized` 已关闭且不再出现在会话列表；会话为内存态，没有持久化认证文件。 |
| `.playwright-cli/` 既有诊断产物保留且未纳入差异 | `PASS` | 根目录和 `frontend/.playwright-cli/` 仍为未跟踪诊断产物，没有删除、移动或纳入任务文件。 |
| Git 差异仅包含本任务资料 | `PASS` | 产品代码、现有测试、合同、迁移、部署配置和活动文档均未修改；预计提交只含当前 Trellis 任务目录。 |
