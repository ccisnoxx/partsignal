# 完善观测与发布管理流程：集成设计

## 1. 任务边界

父任务不直接持有业务实现，负责两个子任务的契约顺序、共享文件生命周期和最终集成验收：

1. `07-28-observation-evidence-management`
   - 推翻人工观测累计阶段模型。
   - 实现整条更正链删除和通用附件清理。
2. `07-28-publication-management`
   - 依赖子任务一提供的通用 FileRecord 生命周期。
   - 实现未公开发布记录的受约束删除、发布管理页面和关注事项入口。

## 2. 权威边界

- `contracts/openapi.yaml` 先定义 HTTP 请求、响应、动作和 DELETE 接口。
- `contracts/database.md` 定义人工观测事实、删除资格、事务级触发器门禁、文件清理和历史指标。
- PostgreSQL 负责最终删除门禁、外键完整性和追加式历史例外。
- 后端服务负责锁顺序、资格检查、审计和动作投影。
- 前端只消费生成类型与服务端 `available_actions`，不重建资格或状态机。

## 3. 共享文件生命周期

现有引用检查已经覆盖三类真实 FileRecord 外键，但清理器只处理平台 Logo。子任务一把通用能力收敛到文件服务：

- 实时引用检查统一覆盖 `platform_profiles.logo_file_id`、`publication_attachments.file_id`、`geo_observation_attachments.file_id`。
- 解除关联后只设置 `cleanup_after`；平台 Logo 继续保留七天，删除聚合产生的独占附件立即到期。
- 清理器在独立事务声明 `DELETING` 并提交，随后删除对象；成功写 `DELETED/deleted_at`，暂时失败保留 `DELETING` 重试。
- 数据库聚合删除和对象存储删除不在同一未提交事务中，避免回滚后对象已消失。

## 4. 实施顺序

```text
人工观测契约与迁移
  → 通用 FileRecord 生命周期
  → 观测服务/API/前端/测试
  → 发布删除契约与迁移
  → 发布服务/API/前端/测试
  → 真实 API Playwright 集成验收
```

两个子任务分别可验收，但发布删除不能在通用附件清理完成前实现第二套清理路径。

## 5. 兼容与迁移

- 历史 `LEGACY_MODEL_RESULT` 保持只读，继续投影旧推荐、引用和准确性。
- 既有人工观测保留 `discovered`、`mentioned`、`accuracy`；升级时物理删除人工逐篇 `recommendation_status` 和 `cited` 列及累计约束，不推断替代值。
- 删除与列移除属于破坏性业务变更。迁移必须基于实现时唯一 Alembic head 创建；旧 revision 不修改。
- 一旦升级后发生新人工观测写入或受约束删除，回滚不得伪造已丢失字段或历史，需以前向修复或迁移前备份恢复。

## 6. 失败与回滚

- 任何资格检查、触发器、审计或数据库异常都回滚整个聚合删除。
- 对象存储删除失败不回滚已提交的业务删除；FileRecord 保持 `DELETING`，由定时任务重试。
- Playwright 验收使用显式 `VITE_API_PROXY_TARGET` 启动参数连接真实后端，不修改产品默认端口来适配一次本地进程。
