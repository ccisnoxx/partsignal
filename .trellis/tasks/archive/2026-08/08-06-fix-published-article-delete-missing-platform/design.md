# 修复已删平台来源的发布成果永久删除：技术设计

## 1. 最小设计

继续由 `backend/app/services/publication.py` 的 `permanently_delete_published_article` 唯一拥有成果聚合删除和来源任务状态转换，不新增服务、状态或兼容层。

删除发布聚合后，根据已经锁定的来源任务实时平台外键确定唯一提交态：

```text
platform_profile_id != NULL -> ContentTask.OPEN
platform_profile_id == NULL -> ContentTask.CANCELLED
```

两条分支都递增任务 revision，并原样保留 `current_content_version_id`、批准内容和 `archived_at`。该判断只使用内容任务自己的权威外键；不读取平台名称快照猜测平台，不自动改绑，不访问外部 URL。

## 2. 状态与数据库约束

当前 `0038` 约束允许归档任务为 `OPEN | COMPLETED`，但新合同要求已归档且失去平台的来源任务在成果删除后成为 `CANCELLED`。为保持 `archived_at` 与业务状态正交，新增 Alembic revision `0039`：

- 将归档状态约束扩展为 `archived_at IS NULL OR status IN ('OPEN', 'COMPLETED', 'CANCELLED')`；
- 不修改历史行、不增加列、不回填或猜测数据；
- downgrade 前若存在已归档 `CANCELLED` 任务则以 PostgreSQL `55000` 明确拒绝，否则恢复 `0038` 约束；
- 保留 `OPEN` 必须绑定实时平台的既有约束，因此不会产生无平台开放任务。

不在应用层清空 `archived_at` 来绕过约束；那会破坏既有“归档是正交可见性”的单一合同。

## 3. 删除事务

现有锁、revision、确认文本、GEO 阻断和删除顺序保持不变。只调整发布聚合删除后的任务状态：

1. 锁定来源任务、工作和成果并复核成功发布闭环；
2. 复核 revision、确认文本和 GEO 下游引用；
3. 删除成果拥有的工作、事件、核验、附件关系和问题；
4. 任务仍绑定平台时恢复 `OPEN`；平台外键为空时转为 `CANCELLED`；
5. revision 递增，归档标记和批准内容保留；
6. 写入与实际状态一致的中文成功审计并提交。

发布事件和核验继续只是同聚合内部删除范围，不进入 blocker 投影。外部 `final_url` 继续只用于确认展示，不执行网络请求。

## 4. 前端与合同

API 形状、动作投影和删除预览不变，不新增结果状态字段。确认弹窗使用确定性的条件文案：来源内容与批准版本保留；平台仍存在时任务恢复待发布，原平台已删除时任务转为已取消；外部页面不会删除。

同步更新：

- `contracts/database.md`；
- `.trellis/spec/backend/publication-workbench-guidelines.md`；
- `.trellis/spec/backend/database-guidelines.md`；
- `docs/GEO多平台内容运营系统方案设计.md`；
- 前端确认文案及组件测试。

OpenAPI 没有字段或语义签名变化，无需重新生成 TypeScript Schema。

## 5. 测试与风险

新增一个 PostgreSQL 集成场景，按真实顺序完成发布、归档来源任务、停用并删除平台，再永久删除成果，断言：

- 删除成功且发布工作、成果、事件和核验消失；
- 来源任务 `platform_profile_id=NULL`、`status=CANCELLED`、revision 递增；
- `archived_at` 和批准内容保留；
- 恢复归档后任务仍为 `CANCELLED`，不会进入发布就绪列表；
- 成功墓碑存在且内部聚合没有部分残留。

现有集成测试继续证明平台存在时恢复 `OPEN`、归档标记保留、GEO 引用阻断和直接数据库删除守卫不变。

主要风险是数据库 head 增加 revision；该迁移只替换检查约束，不重写数据。应用回滚到旧代码仍能读取新状态，但数据库 downgrade 在出现新合法状态后必须拒绝，以免建立无法满足的旧约束。

`clean-code-design` 与 Ponytail 的约束：状态选择留在现有领域所有者中，用一个明确条件完成，不抽 helper、不加策略类；新增迁移仅因为已归档 `CANCELLED` 是用户批准合同所必需。
