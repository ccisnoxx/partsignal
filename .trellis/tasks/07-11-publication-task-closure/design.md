# 发布与任务闭环完整性设计

## 核心不变量

1. `PublicationRecord.platform_account.platform_profile_id` 必须等于 `ContentTask.platform_profile_version.platform_profile_id`。
2. 第一条关联发布转为 `VERIFIED` 时，仍为 `OPEN` 的任务在同一事务自动转为 `COMPLETED`。
3. `COMPLETED` 是历史终态，不因发布后来失效而回退。
4. 发布转为 `REMOVED` 或 `VERIFICATION_FAILED` 时创建一个独立 `OPEN` 异常待办，不自动创建修复任务。
5. 异常待办只有在用户填写非空处置说明并显式解决时转为 `RESOLVED`。
6. 修复任务固定继承原产品、问题和平台，但事实版本与平台规则版本必须重新显式选择。

## 数据模型

### `PublicationAttention`

新增发布异常实体：

- `id`
- `publication_record_id`，唯一；一个终态异常发布只产生一个待办
- `trigger_status`：`REMOVED | VERIFICATION_FAILED`
- `status`：`OPEN | RESOLVED`
- `revision`
- `opened_at`
- `resolved_at`、`resolved_by`、`resolution_comment`

异常待办是业务状态，不从日志或 Dashboard 计数反推。状态变更使用乐观锁并追加审计。

### 修复任务来源

在 `content_tasks` 增加可空且唯一的 `source_publication_attention_id`。该字段由修复任务创建命令写入，形成一个待办至多一个修复任务的明确来源。待办读取投影通过该字段返回关联任务，不在两个表重复保存可变关系。

### 数据库约束

- 增加跨表约束触发器，拒绝新建平台不一致的发布记录。
- 发布记录的内容版本、账号和平台绑定保持不可变。
- 异常待办只能以 revision 为 0 的 `OPEN` 状态创建，禁止直接插入 `RESOLVED`、绕过 revision 转换或删除历史待办。
- 修复任务仍使用现有 `ContentTask`，不创建第二套任务模型。

## 服务端事务

### 创建发布

服务层锁定并读取 `ContentVersion → ContentTask → PlatformProfileVersion` 与账号平台，在写入前执行平台一致性校验。数据库触发器提供最终防线；前端过滤不构成安全控制。

### 验证发布

`verify` 命令在一个事务中：

1. 锁定发布记录和关联内容任务。
2. 校验 `content_matches=true` 与合法状态转换。
3. 写入 `VERIFIED` 和 `PublicationStatusEvent`。
4. 若任务仍为 `OPEN`，写入 `COMPLETED`、递增 revision 并追加任务审计。
5. 提交后返回发布详情和关联任务最新状态。

删除公共 `completeContentTask` API 与前端按钮。任务取消命令必须拒绝仍存在 `PENDING_MANUAL_PUBLISH`、`PLATFORM_REVIEW` 或 `PUBLISHED` 发布的任务；用户需先显式处置发布记录。

### 发布失效与异常

`remove` 或 `mark-verification-failed` 在同一事务写发布终态、状态事件、审计和唯一 `OPEN PublicationAttention`。任务不回退。

创建修复任务不会改变待办状态。解决命令要求 `expected_revision` 和去除空白后非空的说明，写入 `RESOLVED` 与审计。

## 修复上下文与任务创建

新增服务端 `PublicationRepairContext` 查询投影，返回：

- 异常、原发布、原内容任务摘要。
- 固定的原产品、目标问题和平台。
- 原事实版本、当前可选 `APPROVED FactVersion` 及规范化差异。
- 原平台规则版本、当前 `ACTIVE PlatformProfileVersion` 及规范化差异。
- 从原任务预填且可编辑的受众、角度、转化目标、格式、长度和 `canonical_url`。

专用创建修复任务命令重新锁定待办和候选版本，校验待办仍为 `OPEN`、尚无修复任务、产品/平台归属一致、事实仍为 `APPROVED`、规则仍为 `ACTIVE`，然后创建标准 `ContentTask`。

差异由服务端单一投影生成，审核页与修复页复用相同字段语义；不把任意 JSON diff 逻辑分散到多个前端页面。

## OpenAPI 读模型

- `PublicationCandidate`：内容/任务 ID、标题版本、锁定平台 ID/名称/规则版本、栏目和匹配账号上下文。
- `PublicationRecord` 详情补充关联 `task_id` 与服务端投影的 `available_actions`。
- `PublicationAttentionList/Detail`：异常、原发布/任务上下文、状态、revision、关联修复任务和处置记录。
- `PublicationRepairContext` 与专用创建命令。
- 删除 `completeContentTask`。

前端新增可深链的发布详情与修复路由。状态按钮只渲染 `available_actions`，服务端仍重复校验。

## 历史完整性与迁移

只读 CLI/检查器输出：

- 缺少追加式 `PublicationStatusEvent.status=VERIFIED` 历史的旧 `COMPLETED` 任务；发布后来变为 `REMOVED` 或 `VERIFICATION_FAILED` 不会把合法完成历史误判为异常。
- 非终态且平台错绑的发布记录。

未处置记录阻断迁移/上线。用户通过现有或新业务命令完成发布验证、拒绝/移除错绑记录并创建正确发布；不自动改绑或回退任务。`REJECTED`、`REMOVED`、`VERIFICATION_FAILED` 的旧跨平台记录视为已处置历史，不再阻断，但仍完整保留历史和审计。

迁移顺序：完整性检查清零 → expand 表/列/约束 → 部署后端 → 生成前端类型并部署前端。旧人工完成入口随契约升级移除，不保留兼容分支。

## 回滚

- 新异常和修复任务来源一旦产生，不通过回滚删除。
- 若前端回滚，后端仍保持平台门禁和自动完成；旧前端不得再调用已删除入口。
- 若必须回滚后端，先停止所有写流量并确认没有新状态需要旧代码理解。

## 最终确认的接口与所有权

- `ContentTask.available_actions` 只投影可执行 `CANCEL`；不存在人工 `COMPLETE` 动作。
- `PublicationRecord.available_actions` 由发布应用服务按当前状态投影，前端不维护第二份转换表。
- `PublicationAttention` 是发布异常业务状态唯一来源；Dashboard 不再从终态发布记录临时反推待办。
- 修复任务请求只接收重新选择的事实/平台规则版本和可编辑策划字段，不接收可漂移的产品、问题或平台 ID。
- 差异投影只比较确认字段，不在前端或服务端执行任意 JSON 模糊 diff。
- `preflight-integrity` 稳定输出 `check`、`record_type`、`record_id`、`reason_code`、`related_ids`，任一问题使用非零退出码；不支持隐藏 allowlist。
- Goal 2 的事实/内容审核上下文由 `review-evidence` 拥有；本任务只提供其所需的任务、发布与修复稳定语义，不把审核投影并入发布服务。

## 迁移与回滚补充

- `0013` 执行前必须完成发布历史检查；迁移本身也应对关键前置条件失败，避免绕过部署脚本直接迁移。
- 新异常、修复来源和审计记录一旦产生不得通过 downgrade 删除；应用旧版本不能理解新状态时只允许前滚。
- 前端回滚不得恢复调用已删除 complete 端点；无法满足时停止写流量而不是增加兼容 API。
