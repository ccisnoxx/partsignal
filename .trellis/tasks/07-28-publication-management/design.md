# 完善发布管理流程：技术设计

## 1. 发布记录受约束删除

新增 `DELETE /api/v1/publication-records/{publication_id}`，成功返回 `204`。

删除资格同时满足：

- 追加式状态事件中从未出现 `PUBLISHED` 或 `VERIFIED`。
- 不存在 `GeoObservationCitation` 或 `GeoObservationPublication` 引用。
- 不存在 `PublicationAttention`；因此也不存在通过关注事项绑定的修复任务。

当前状态不是资格来源；资格必须读取完整历史事件。符合资格的 `PENDING_MANUAL_PUBLISH`、`PLATFORM_REVIEW` 或从未公开的 `REJECTED` 记录均可删除。

服务流程：

1. 使用现有“具体平台 + 内容哈希” advisory lock，再锁发布记录。
2. 批量检查历史事件与全部下游引用；任一阻断返回结构化 `409 PUBLICATION_RECORD_IN_USE`。
3. 设置事务本地 `partsignal.publication_record_delete_id`。
4. 显式删除聚合内部的附件关系和未公开状态事件，再删除发布记录。
5. 追加 `publication_record.deleted` 安全审计，提交后由通用 FileRecord 生命周期清理独占附件。

迁移只为 `publication_status_events`、`publication_attachments` 和 `publication_records` 增加受限 DELETE 门禁；关注事项和 GEO 关系不放行删除。

## 2. 动作投影

- `PublicationAction` 增加 `DELETE`。
- 列表以批量 EXISTS/聚合计算删除资格，不产生逐行查询。
- 详情和删除命令重新校验相同规则，前端隐藏不能替代服务端门禁。
- 服务端动作顺序继续表达高频优先级；前端渲染首个高频动作及其余“更多操作”，不再丢弃数组后续项。

## 3. 发布管理页面

- 稳定路由仍为 `/publications`。
- 左侧导航、总览快捷入口、页面 eyebrow、面包屑和返回文案统一使用“发布管理”；“人工发布”只保留为候选登记动作。
- 发布记录表：
  - 内容标题作为弹性列。
  - 状态、时间、平台、账号和操作使用紧凑宽度。
  - 宽表仅在 `TableRegion` 横向滚动，操作列固定。
  - “登记发布结果”或“查看记录”为主入口，其余动作在可访问的 Dropdown。
- 删除、标记已移除、验证失败均显示不同影响说明，不能共用模糊“删除”文案。

## 4. 发布需关注

- 总览“发布需关注”直接导航 `/publications?tab=attentions`。
- 关注 Tab 增加简短说明：已移除或验证失败的记录会进入此处，需要创建修复任务或写明处理结果后显式解决。
- 继续使用唯一 OPEN attention、现有详情、修复和解决接口，不新增状态或第二个入口模型。

## 5. Playwright 环境

当前 5173 Vite 进程默认代理 8000，而后端运行在 18000。验收重启本任务前端时显式设置：

```bash
VITE_API_PROXY_TARGET=http://127.0.0.1:18000
```

该差异是本地启动配置，不修改 `vite.config.ts` 的产品默认值。
