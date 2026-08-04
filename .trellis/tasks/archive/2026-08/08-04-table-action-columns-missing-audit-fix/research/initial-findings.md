# 全站操作列缺失：初步证据

## 1. 既有合同基础

- 归档任务 `08-01-global-resource-available-actions-convergence` 已把资源命令统一为服务端 typed `available_actions` 投影；当前任务不能恢复前端按角色或状态猜测动作。
- 归档的 24 表矩阵已经区分资源命令、详情导航和真正只读表，但没有统一约束“合法无命令”的操作单元格如何表达。

## 2. 已确认缺陷

### F1：产品列表丢弃服务端 `UPDATE`

- 后端 `backend/app/services/product_facts.py:42-70` 为每个产品固定投影 `UPDATE`，无引用且允许删除时再追加 `DELETE`。
- 前端 `frontend/src/features/product-facts/ProductsPage.tsx:99-104` 只判断 `DELETE`；没有删除资格时直接显示 `—`，完全忽略 `UPDATE`。
- 线上只读复核：当前列表 1 行，API 为 `available_actions=[UPDATE]`，操作列为 `—`，没有按钮或链接。
- 结论：这是已证实的跨层动作消费缺陷，不是权限或终态导致的合法空动作。

### F2：内容任务列表把非取消动作误解释成删除

- 后端 `backend/app/services/projections.py:132-154` 的任务动作包含 `CANCEL`、`DELETE`、`CREATE_GENERATION_JOB`、`CREATE_MANUAL_VERSION`。
- 前端 `frontend/src/features/content-tasks/ContentTasksPage.tsx:255-301` 只识别 `CANCEL`，其余任何 token 都映射为“删除任务”并进入删除确认。
- 当前线上两条 API 记录均因终态/受保护历史返回空动作，因此现有数据只显示“查看详情”和禁用更多按钮；这没有触发误删除分支，但不能证明实现正确。
- 结论：开放任务重新出现生成或人工录入动作时，列表会错误命名并路由命令；必须按 typed token 显式映射，未知 token 显式失败。

## 3. 合法空动作但界面表达不完整

### F3：内容任务子表混用空白和禁用占位

- `frontend/src/features/content-tasks/ContentTasksPage.tsx:666-675` 在 AI 作业没有 `RETRY` 时返回 `null`，操作单元格为空白。
- 同文件 `:688-704` 在内容版本没有 `CREATE_HUMANIZATION_JOB` 时保留禁用“自然化”按钮；版本号本身仍是详情入口。
- 线上代表任务的内容版本确实显示禁用“自然化”，没有可执行行命令。
- 结论：同一页面对“无可用命令”存在两种表达，且禁用按钮没有直接解释资格原因。

### F4：发布终态行会渲染空操作单元格

- `frontend/src/features/publications/PublicationsPage.tsx:88-122` 的 `ActionButtons` 只渲染 `primary_action` 和次动作；动作数组为空时返回空 `Space`。
- 服务端对已关闭发布工作、已解决内容问题、已有开放问题或已退役的发布成果依法返回空动作；这些对象仍有只读详情。
- 结论：服务端合同正确，问题是前端在保留“操作”列时没有提供详情入口或明确的只读表达。

### F5：GEO 问题库丢弃服务端 `UPDATE`

- `backend/app/services/content_planning.py:29-37` 为每个问题主题固定投影 `UPDATE`，`backend/app/routers/planning.py:76-96` 已提供带 revision 守卫的 PATCH。
- `frontend/src/features/geo-observations/GeoTopicsPage.tsx:65-89` 只渲染数据列，没有消费 `available_actions`。
- 结论：问题库不是只读表，应补回编辑入口，不能为满足旧清单而忽略现有命令。

### F6：AI 渠道操作日志有详情合同但没有入口

- `frontend/src/features/configuration/AIChannelDetailPage.tsx:484-495` 展示日志行但没有操作列。
- 全局审计已通过 `auditLogDetailQueryOptions` 和共享 `AuditLogDetailPanel` 提供相同日志对象的详情。
- 结论：日志仍不可修改，但按批准规则应增加“查看详情”。

## 4. 根因分类

1. **投影已提供但前端丢弃**：产品 `UPDATE`。
2. **typed token 被错误聚合处理**：内容任务创建类动作误入删除分支。
3. **合法无命令但操作列留空**：AI 作业、发布历史等。
4. **合法无命令但显示无解释的禁用按钮**：内容版本自然化等。
5. **没有独立行操作**：父级表单输入矩阵和非持久聚合表不机械添加操作列。

## 5. 规划约束

- 以当前 25 表源码清单逐项核对，不能只修用户点名的三个页面，也不能沿用旧矩阵对“只读”的误判。
- 资源命令继续来自服务端 `available_actions`；查看详情、打开冻结快照等纯导航动作可以由前端路由合同提供，但必须与资源命令明确分层。
- 不为填满操作列新增业务命令，不放宽批准事实、批准内容、发布成果和历史记录的不可变边界。
