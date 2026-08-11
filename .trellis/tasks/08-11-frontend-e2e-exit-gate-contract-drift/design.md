# Frontend E2E exit gate 合同漂移 — Design

## 1. 边界与合同优先级

本 Task 不设计新业务能力，只消除验证层和稳定规范的漂移。判断顺序为：

1. `contracts/database.md` 与已执行的 0037 migration 定义永久审计保留边界；
2. 运行时 `RETAINED_AUDIT_ACTIONS`、service 实现和 OpenAPI 定义当前可执行合同；
3. production UI 的真实可访问名称定义 TableRegion 清单目标；
4. E2E、Trellis spec 和 docstring 必须向上述权威来源收敛，不能反向驱动 production 合同。

没有 schema、API、状态机、权限或 UI migration，也不需要兼容层。

## 2. 审计合同纠偏

0037 将永久审计收缩为成功事件白名单，并一次性删除白名单外历史。`ai_model.tested` 不在 migration 或运行时白名单；把它重新加入会扩大永久审计合同、违背本 Task 目标，也会把一次可重复的连接探测错误提升为永久业务事件。

`test_ai_model` 的权威职责是：读取当前连接配置、释放锁执行外部调用、按渠道/模型 revision 防止旧结果覆盖新配置，再回写最新测试状态并保持模型停用。它不写审计。

当前 E2E 随后显式启用模型。`set_model_enabled` 会写入白名单内的 `ai_model.enabled`，并通过 `facts.channel_id` 进入该渠道的操作日志投影。因此仅替换一个断言即可同时证明：测试门禁通过、显式启用已执行、渠道日志能看到真实永久事件。

稳定规范同步删除“测试/发现进入审计”的错误说法；docstring 只描述实际状态回写，不增加解释性抽象或 production 分支。

## 3. UI 清单纠偏

`ContentTasksPage` 已使用 `TableRegion label="AI 生成记录列表"`，且卡片标题、loading/error 文案同属“AI 生成记录”语言。清单的 `label`、源码 `marker` 与浏览器 `regionLabel` 是同一可访问名称的三份测试登记，必须一起改为“AI 生成记录列表”。production 页面保持不变。

## 4. DELETE 请求纠偏

OpenAPI 要求 `DELETE /products/{product_id}` 携带 `expected_revision >= 0`。不存在资源没有可读取 revision，合同测试使用 `0` 作为语法有效且不会命中真实资源的占位 revision。

管理员请求补 query 后可越过请求校验并验证 `404 NOT_FOUND`。工程师请求也补相同 query，使 `403` 权限断言验证服务端授权，而不是偶然依赖框架校验/依赖解析顺序。

## 5. Phase 3 gate 与文档

代码、测试、spec 和 docstring 完成后先运行全部 required validation。只有 `make verify` 零失败，才在迁移计划当前 Phase 3 段落按时间顺序追加：

1. 前置 `frontend-v2-content-task-detail-platform-fixture` 修复了 backend fixture，但当次 `make verify` 为 `49 passed / 3 failed`，所以当时仍为 `NOT_MET`；
2. 本 Task 对齐三个合同漂移，并记录实际 targeted 与完整 `make verify` 证据；
3. 当前 Phase 3 exit gate 改判为 `MET`。

更早 `frontend-v2-content-abstraction-review` 的 `NOT_MET` 和归档任务原文不修改。若 `make verify` 出现任何新的范围外失败，不更新迁移计划，不扩大任务。

## 6. Rollback shape

- 代码/测试/spec 回滚：逐个撤销本 Task 的聚焦 hunk；不恢复 `ai_model.tested`，不放宽数据库触发器或修改 API。
- gate 文档回滚：只移除本 Task 新增的当前证据与 `MET` 段落，保留所有历史 `NOT_MET`。
- 数据回滚：E2E 只使用脚本创建的临时 PostgreSQL database 和临时存储；EXIT trap 必须删除，Redis 仅作为 broker，不承载业务状态。

## 7. 后续三个失败的合同判断

### 7.1 AI 渠道固定列

1440px 下应用侧栏、188px 状态栏与 340px 详情栏仍同时存在，渠道表声明的列宽总计 832px，中央列表实际可用宽度小于该值。视觉规范允许且要求宽表只在 `TableRegion` 内横向滚动；Ant 固定操作列覆盖当前未滚入视口的普通列是预期实现。E2E 应验证表格确有局部溢出、操作列完整落在局部视口内、文档本身不溢出，不要求不可同时成立的“无局部滚动”和“测试状态列不得位于固定列下方”。

### 7.2 审计时间列

审计列表渲染固定格式的完整北京时间，`time` 明确禁止换行。144px 列在实际 11px tabular 数字字体与单元格 padding 下会产生内容裁切，属于生产表格列宽缺陷。仅把该列宽增至 160px；不缩短时间、不隐藏秒、不修改格式化函数，也不放宽全站裁切检测。

### 7.3 自然化确认按钮

生产弹窗当前 `okText` 为“创建自然化生成记录”，与页面统一的“AI 生成记录”语言一致；E2E 仍等待旧名“创建自然化作业”，所以没有发生点击或 POST。只更新定位名称，不改弹窗或自然化请求行为。

## 8. 内容任务删除触发器回归

`contracts/database.md` 与 0033/0035/0040 的触发器都只允许在匹配 `partsignal.content_task_delete_id` 的事务内，把所属 `ContentVersion.source_job_id` 置空；其他身份、正文和状态仍不可变。0042 新增 `ContentVersion.updated_at` 后，ORM 列声明带 `onupdate=now()`，使 `_delete_task_core` 的批量断链 UPDATE 自动同时写入 `updated_at=now()`。因此 AI 版本从非空作业引用断链时不再满足“除 `source_job_id` 外完全相同”的触发器条件，并以 SQLSTATE `55000` 失败；HUMAN 版本因旧值本来就是 NULL，现有集成测试没有覆盖该分支。

触发器本身与权威数据库合同一致，不应放宽为允许删除过程改写时间或其他字段，也不应修改冻结的 0040/0042 历史 migration。最小修复在 `_delete_task_core` 的内部批量 UPDATE 显式赋值 `updated_at = content_versions.updated_at`，覆盖 ORM `onupdate` 且保持真实内容更新时间不变。现有 PostgreSQL 生命周期集成测试增加一个终态 GenerationJob 及其 AI ContentVersion，证明完整聚合删除成功；E2E 继续覆盖 API 闭环。
