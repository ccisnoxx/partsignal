# 第二轮七组修复集中回归报告

## 1. 结论

**第二轮修复闭环暂不通过。**

14 个原问题/决策项中，13 项取得本轮独立通过证据；`PS-QA2-UI-002` 仍有一个真实产品缺陷：发布候选抽屉在无未提交内容时直接关闭，焦点没有返回原触发器，而是落到 `BODY`。同时完整 E2E 为 `44 passed, 8 failed`，失败均已归因为旧 fixture、旧合同期待和旧视觉基线，但门禁在修复并重跑前仍是红色。

本任务遵守测试/报告边界，没有修改产品代码、现有测试、合同、迁移、部署配置或活动文档，也没有把失败改写成通过。

## 2. 基线

| 项目 | 值 |
| --- | --- |
| run-id | `R2-FIX-CLOSURE-20260801-01` |
| 冻结时间 | `2026-08-01 19:44:33 CST` |
| 分支 / 提交 | `main` / `97163c4dc2ba601d2bb54893fb8dca9ccc54415f` |
| 数据库迁移 | current=head=`0033_task_owned_history_delete` |
| 工作提交 | `5808545`、`62c4e16`、`2e59943`、`95b34bc`、`6c45c09`、`f491809`、`6f8ca05`、`fab7e9c` 均为当前提交祖先 |
| 环境边界 | 开发 API/前端/PostgreSQL/Redis/Worker/Scheduler 运行；staging `fake-oss` 独占 19001，未停止或修改 |

## 3. 自动化结果

| 门禁 | 结果 | 数量与耗时 |
| --- | --- | --- |
| `make contract-check` | `PASS` | OpenAPI/FastAPI 递归语义与生成 TypeScript 通过，`1.50s` |
| `make test-unit` | `PASS` | 后端 `141`、前端 `184`、资产 `24`，合计 `349` 个断言级测试通过，`258.33s` |
| `make test-integration` | `PASS` | PostgreSQL `70 passed in 90.53s`，实际 `92.37s` |
| `make e2e` | `FAIL` | `44 passed, 8 failed`，约 `4.8m`，实际 `296.31s` |
| `make lint` | `PASS` | `3.92s` |
| `make typecheck` | `PASS` | mypy `68` 个源文件 + TypeScript，`3.20s` |
| `make build` | `PASS` | 后端/前端镜像、Vite `4933` modules、生产资产门禁，`35.56s` |
| AI 配置并发定向用例 | `PASS` | `2.92s` |
| 开发对象存储单元测试 | `PASS` | `6 passed` |

E2E 的 8 个失败不是七组修复代码的同一运行时回退，但都是当前仓库门禁资产缺陷：

- compatibility 与 Trusted Types 在 Chromium/Firefox/WebKit 的 6 项 mock 没有补上 `PS-QA2-DEC-002` 已批准为 required 的 `available_actions`；产品消费者按合同调用 `.includes(...)` 后页面无法完成后续断言。
- `mvp-flow.spec.ts:503` 仍期待未配置全局自然化 Prompt 时“自然化”按钮可用；服务端当前只在 Prompt 已配置时投影 `CREATE_HUMANIZATION_JOB`，旧期待与批准合同相反。
- `dashboard-light-1440x1000.png` 落后当前已提交 Dashboard，稳定差异为 `118054` 像素、比例 `0.09`。

24 表双视口和 200% 缩放用例在这次完整 E2E 中均通过。脚本结束后，本轮隔离数据库和临时对象存储均已删除，开发前端也恢复到执行前状态。

## 4. 原问题闭环

### 4.1 已通过

- `PS-QA2-FUNC-001`：共享开发 `COMPLETED` 任务中有 2 个失败作业，服务端动作均为 `[]`，真实页面没有“重试原快照”；同状态、不同投影的组件测试也只为 `RETRY` 项显示按钮。
- `PS-QA2-FUNC-002`：已解决发布异常的动作投影为 `[]`，真实修复直达页显示只读说明，表单和创建按钮均不存在。
- `PS-QA2-FUNC-003`：非链尾人工 GEO 记录的动作投影为 `[]`，真实更正页提示“当前记录不可更正”，备注、文件选择和提交均禁用。
- `PS-QA2-DELETE-001`：渠道与 Header 并发删除均由同一个定向 PostgreSQL 用例证明单一 `204`、落后 `404`、单一成功审计和单次失效副作用。
- `PS-QA-201`：Dropdown→危险确认→取消后，焦点精确回到原“更多操作”按钮。
- `PS-QA-202`、`PS-QA-203`：六类危险删除页面的用户可见“物理删除”扫描为 0；AI Header 真实确认框完整说明渠道/全部模型停用、测试状态与最近测试信息清理以及重新启用条件。
- `PS-QA2-UI-001`：匿名登录页 `/favicon.svg` 返回 `200`，没有 `/favicon.ico` 请求；生产资产门禁通过。
- `PS-QA2-UI-003`：发布详情 Timeline 使用 `items.content`；真实“状态轨迹”页面没有目标弃用警告。
- `PS-QA2-TEST-001`：清单为 `24/24` 个唯一 region，两个弹窗表分别限定在“登记人工观测”和“获取模型” dialog；完整 E2E 的桌面/移动用例通过。
- `PS-QA2-ENV-001`：在不停止 staging 19001 的前提下，以不落盘 override 启动开发 `fake-oss:19002`。真实浏览器 PUT `204`、API complete `200/VERIFIED`、浏览器签名 GET `200` 且 47 字节一致；容器日志无运行期依赖同步。
- `PS-QA2-DEC-001`：三份活动文档的旧删除条件为 0；现行口径与 `contracts/database.md`、`0033`、删除 service 和集成测试一致。
- `PS-QA2-DEC-002`：合同检查通过，前端资源消费者当前有 66 处 `.available_actions.includes`；从收敛提交到冻结提交没有恢复基于角色/局部状态的生产资格旁路。

### 4.2 未通过：`PS-QA2-UI-002`

桌面审计侧栏和移动审计 Drawer 均通过，发布抽屉的 dirty→确认放弃路径也由组件测试通过；失败只出现在候选抽屉的“无修改直接关闭”路径。

根因位于 `PublicationWorkspace.tsx` 的 Drawer 生命周期：

1. 打开时保存真实触发器。
2. 关闭回调立即清除 `candidate`/`record` query。
3. `PublicationDrawer` 的 key 由目标 ID 计算，随即从目标 ID 变成 `closed:view`，旧实例被替换。
4. 旧 Drawer 未完成关闭动画，`afterOpenChange(false)` 没有机会调用 `onAfterClose={drawerFocus.restoreFocus}`，焦点最终落到 `BODY`。

最小权威修复位置是发布工作台持有的 Drawer 身份/关闭时序及对应直接关闭组件测试，不需要修改通用 `useFocusReturn`，因为同一 Hook 在审计和确认框链中已经通过。

## 5. 操作列、文档与对象存储

### 动作投影

用户、产品/事实、平台/Prompt、AI 渠道/Header/模型、发布账号、内容任务/作业/版本、发布候选/记录/异常和 GEO 更正/删除继续消费各资源自身的 `available_actions`。集合级创建、纯导航/查看/复制/筛选/导出/打印、认证自服务和文件传输内部动作保持批准的排除边界，没有擅自扩大合同。

### 内容任务删除文档

三份活动文档均表达当前 `0033` 边界：只有 `CANCELLED` 任务可进入删除判定；任务自有生成作业、审核记录及 `DRAFT/PENDING_REVIEW/CHANGES_REQUESTED` 内容可清理；`APPROVED/SUPERSEDED` 内容、发布记录或修复来源继续返回 `CONTENT_TASK_IN_USE`。历史归档报告没有改写。

### 共享开发对象存储

本轮没有修改 `.env` 或 Compose 文件。浏览器必须从配置允许的 `http://localhost:5173` 来源直传；一次使用 `127.0.0.1` 的前置诊断被 CORS 明确拒绝，该上传意图已精确中止并清理，不计为产品失败。正式 smoke 在 localhost 来源完整通过。

两个本轮文件记录最终均保留 `DELETED` 墓碑，对象与 metadata 均为 `MISSING`。开发 `fake-oss` 和 19002 override 已移除，开发 API 恢复原对象存储环境变量，staging 19001 全程运行。

## 6. 新问题分流与推荐顺序

建议新建四个独立任务，不把产品焦点、E2E fixture、视觉基线和通用组件兼容再次合并：

1. `08-01-publication-drawer-direct-close-focus-restoration`：修复真实产品缺陷，并增加无 dirty 直接关闭回归。
2. `08-01-e2e-available-actions-contract-sync`：同步 compatibility/Trusted Types mock 和 MVP 自然化合同期待；不得在产品 Schema 或消费者中增加旧 fixture fallback。该任务可与第 1 项独立进行。
3. `08-01-dashboard-visual-baseline-sync`：先确认当前 Dashboard 是批准外观，再只更新对应视觉基线；可独立进行，但应在当前 UI 不再变化后执行。
4. `08-01-antd-alert-content-prop-compatibility-cleanup`：真实修复页还出现 `[antd: Alert] message is deprecated`，源码有 10 处同类属性；作为独立前端兼容任务处理，可与前两项并行。

完成第 1～3 项后必须重新运行完整 `make e2e`；第 4 项至少运行定向组件测试与真实 console smoke。只有产品焦点路径与完整 E2E 均通过，才能把第二轮修复闭环改判为通过。

## 7. 清理与提交边界

- 本轮 E2E 数据库 `partsignal_e2e_20260801_95715` 与临时目录 `partsignal-e2e-storage.QwWZKD` 已删除。共享 PostgreSQL 中另有两个既有命名 E2E 数据库，不属于本轮，未触碰。
- `r2-centralized` 浏览器会话已关闭，没有保存认证状态文件。
- `.playwright-cli/` 和 `frontend/.playwright-cli/` 诊断产物保持未跟踪、未删除、未纳入任务差异。
- 当前任务预计提交只包含 `.trellis/tasks/08-01-round-2-seven-group-centralized-regression/`；不自动推送。
