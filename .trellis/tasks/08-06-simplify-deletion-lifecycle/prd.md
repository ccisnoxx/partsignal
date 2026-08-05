# 收缩删除与归档生命周期规则

## Goal

建立统一、可解释的删除生命周期，减少平台、Prompt、内容任务、发布工作和 GEO 观测之间的手工解依赖。工作阶段的数据可以直接聚合删除；已经成功发布或参与 GEO 观测的任务先归档，再由管理员显式永久删除。

## Background and Confirmed Facts

- 当前内容任务删除会把已批准内容、任意发布工作、修复来源和 GEO 来源全部视为永久阻断条件，见 `backend/app/services/publication.py:1028` 与 `backend/app/services/projections.py:126`。
- 当前平台 Prompt 只要被平台绑定就不能删除，见 `backend/app/services/platform_configuration.py:701`；但生成作业已经保存平台、模型、Prompt 身份及最终消息快照，见 `backend/app/services/content_production.py:130`。
- 当前平台只要被任一任务或账号引用就不能删除，见 `backend/app/services/platform_configuration.py:870`；历史任务和发布工作又以强外键依赖当前平台配置。
- 发布工作、验证、文章身份、发布后问题和 GEO 观测目前通过外键与数据库触发器保持不可变或追加式。该约束适合防止原地篡改，但不应继续等同于“任何情况下都不能整体删除”。
- GEO 观测属于产品与查询主题，一次观测可以关联多篇文章；它不是单个内容任务天然独占的数据。
- 当前发布流程是人工登记 URL，不存在系统代替用户删除外部文章的能力。
- 当前 `audit_logs` 保存成功、失败和拒绝等大量动作，并由数据库禁止删除；用户已确认项目仍处于开发阶段，本任务可一次性全局清理低价值审计。

## Requirements

### 1. 内容任务生命周期

- 归档是独立于 `OPEN`、`COMPLETED`、`CANCELLED` 的可见性状态，不新增 `ARCHIVED` 业务状态。
- 未形成 `PublishedArticle` 且未被 GEO 观测引用的内容任务可以直接聚合删除，不要求先逐项删除草稿、审核记录、生成作业或发布工作。
- 普通删除同时清理任务拥有的内容版本、审核记录、已结束生成作业，以及尚未成功核验的发布工作、事件、失败验证和附件关系。
- 仍有 `PENDING` 或 `RUNNING` 生成作业时暂不允许删除，返回稳定的忙碌错误；不在本任务中新增异步作业取消协议。
- 成功核验形成文章身份，或已经存在 GEO 文章关系的任务，不能使用普通删除，必须先归档。
- 只有 `COMPLETED` 任务可以归档。归档任务从默认内容任务列表和待办中隐藏，但在归档筛选中可查看。
- 归档任务可以恢复。恢复只清除归档标记并增加 revision，不改变原业务状态、内容版本、发布状态或外部页面状态。
- 归档后立即允许管理员永久删除，不设置冷静期。
- 永久删除必须使用独立入口、服务端 revision 校验和二次确认；管理员必须输入固定文本 `永久删除`，界面明确说明不可恢复以及外部页面不会被删除。
- 永久删除原子清理任务拥有的全部内部业务数据，包括已批准内容、审核、生成、发布工作、事件、验证、文章身份和发布后问题。
- 永久删除文章身份时，删除该文章在 GEO 中的逐篇结果关系，并把仍需保留的引用降为普通 URL 引用；共享观测仍有关联文章时必须保留。
- 人工 GEO 更正链在移除目标文章后已不再关联任何文章时，整条更正链随任务永久删除；仍有其他文章时只移除目标文章关系。
- 来源任务永久删除不得级联删除由其派生的修复任务或 GEO 优化任务。下游任务保留自身快照，实时来源外键置空。
- 永久删除失败必须整笔回滚，不能留下部分解绑、部分历史或前端成功但服务端数据仍存在的状态。

### 2. 外部发布页面

- 普通删除和永久删除都只处理 PartSignal 内部记录，不调用、不验证也不等待外部平台删除文章。
- 永久删除预览展示系统当前登记的相关 URL，仅供管理员人工判断，不作为删除条件。
- 管理员不需要证明外部文章已经下线。旧内部发布身份删除后，后续新任务可以重新登记仍存在或重新发布的外部文章。

### 3. Prompt、平台及其他当前配置

- Prompt、AI 渠道、模型和平台账号等当前配置不承担业务历史保存职责；生成与发布历史通过不可变快照展示当时信息。
- 删除仍被平台使用的 Prompt 时，在同一事务内将所有关联平台的 `platform_prompt_id` 置空、增加平台 revision，再删除 Prompt；任一步失败均回滚。
- Prompt 删除确认展示受影响平台数量和名称，并说明这些平台重新绑定 Prompt 前不能发起新内容生成。
- 平台不是内容任务的所有者。平台停用或删除永远不得级联删除内容任务。
- 存在 `OPEN` 内容任务时，平台只能停用，不能硬删除。`COMPLETED`、`CANCELLED` 或已归档任务，以及终态发布历史，不阻止平台硬删除。
- 平台硬删除时，其平台账号作为平台配置子项一并删除；终态发布工作依赖创建时保存的平台和账号标量快照，不再依赖当前配置行。
- 平台或账号删除后，历史任务与终态发布工作仍能显示创建时的平台名称和账号标识；对应实时配置 ID 可以为空。
- 仅被终态发布工作引用的账号允许删除；非终态发布工作仍阻止账号删除。
- AI 渠道和模型继续复用现有 `SET NULL + input_snapshot` 历史语义，不新增第二套配置历史表。

### 4. 审计收缩与开发期全局清理

- 审计只持久化 `SUCCESS` 结果；失败、拒绝、普通浏览、草稿编辑、作业创建/重试、文件临时流程、模型发现和模型测试不再写入永久审计。
- 成功审计保留白名单固定为：
  - 身份安全：`user.created`、`user.updated`、`user.deleted`、`user.exported`、`user.password_changed`、`user.password_reset`。
  - AI 敏感配置：`ai_channel.created`、`ai_channel.updated`、`ai_channel.deleted`、`ai_channel.api_key_replaced`、`ai_channel.enabled`、`ai_channel.disabled`、`ai_channel_header.created`、`ai_channel_header.updated`、`ai_channel_header.deleted`、`ai_model.created`、`ai_model.updated`、`ai_model.deleted`、`ai_model.enabled`、`ai_model.disabled`。
  - 平台与 Prompt：`platform_profile.enabled`、`platform_profile.disabled`、`platform_prompt.created`、`platform_prompt.updated`、`platform_prompt.deleted`、`content_humanization_prompt.saved`。
  - 业务承诺：`fact_version.approve`、`content_version.approve`、`publication_work.completed`。
  - 不可恢复删除：`product.deleted`、`fact_version.deleted`、`content_task.deleted`、`content_task.permanently_deleted`、`platform_type.deleted`、`platform_profile.deleted`、`platform_account.deleted`、`geo_observation.deleted`。
- 新增审计动作必须显式加入白名单，不能因为调用了公共审计函数就自动长期保存。
- 本次 Alembic 迁移一次性删除 outcome 不是 `SUCCESS` 或 action 不在白名单内的全部既有 `audit_logs`；清理是全局的，不按任务逐条触发。
- 全局清理只针对 `audit_logs`，不批量删除产品、事实、任务、内容版本、发布记录、GEO 观测或文件等业务历史。
- `audit_logs` 继续禁止原地 UPDATE，仅保留删除用户时 `actor_id -> NULL` 的现有受控例外；DELETE 不再由数据库绝对禁止，但不提供公开审计删除 API。
- 普通任务删除同步清理任务及已删除子记录的旧审计，只保留本次 `content_task.deleted`；不得留下指向已删除内容版本或发布工作的批准审计。
- 永久删除任务前清理该任务及其已删除子记录对应的旧审计，随后写入唯一最小墓碑 `content_task.permanently_deleted`。墓碑只使用现有必需元数据和空 `details`，不保存正文、Prompt、配置快照、URL 或删除数量。

### 5. 权限与服务端权威

- `ENGINEER` 与 `ADMIN` 均可普通删除符合条件的任务，并可归档、恢复任务。
- 只有 `ADMIN` 可以读取永久删除预览和执行永久删除。
- Prompt、平台和账号删除继续只允许 `ADMIN`。
- 服务端是状态、权限、revision、引用和确认文本的最终权威；前端按钮与弹窗不是安全控制。
- 永久删除不能由归档、恢复、批量列表操作、平台删除或 Prompt 删除隐式触发。

## Out of Scope

- 不新增通用依赖图、任意资源级联删除框架、回收站、延迟删除队列或万能“force delete”接口。
- 不改写内容生成、审核、人工发布、首次核验或 GEO 录入的业务状态机。
- 不远程删除外部文章，不检查外部 URL 是否仍可访问。
- 不在本任务中放宽用户、产品、事实版本、平台类型和 GEO 独立删除接口的其他既有业务门禁。
- 不新增审计保留期调度器、审计导出归档或合规系统。
- 不为运行中的生成作业新增取消能力；存在运行作业时由用户稍后重试删除。
- 不为测试数据引入独立生产后门或绕过权限的清理 API。

## Acceptance Criteria

- [ ] 没有成功文章、GEO 引用和运行中生成作业的任务可以通过一次普通删除清理其内部内容、审核、生成及未成功发布历史。
- [ ] 已批准内容、失败验证、取消或关闭的发布尝试不再单独阻止未发布任务删除。
- [ ] `PENDING` 或 `RUNNING` 生成作业会阻止删除并返回稳定错误，事务不发生部分清理。
- [ ] 成功发布或参与 GEO 观测的任务没有普通删除动作，只能先归档。
- [ ] 默认任务列表不显示归档任务；归档筛选可查看，恢复后业务状态与全部历史保持不变。
- [ ] 归档后管理员无需等待即可永久删除；工程师调用预览或永久删除接口返回 `403 PERMISSION_DENIED`。
- [ ] 永久删除确认文本或 revision 不匹配时服务端拒绝；前端确认文本不匹配时不发送请求。
- [ ] 永久删除预览展示内部删除范围和已登记 URL，并明确外部页面不受影响。
- [ ] 永久删除成功后，任务及其已批准版本、生成与审核、发布与验证、文章身份和独占 GEO 历史均不能再由 API 查询。
- [ ] 共享 GEO 观测仍有其他文章时保持可查询，只移除被删文章关系；没有剩余文章的人工更正链被完整删除。
- [ ] 来源任务删除后，下游修复或优化任务仍存在，实时来源为空，自身来源快照保持不变。
- [ ] 永久删除只留下一个空 `details` 的最小任务墓碑审计，不残留该任务子记录的批准、发布或删除审计。
- [ ] 普通任务删除只保留本次 `content_task.deleted`，不残留指向已删除子记录的审计。
- [ ] 删除绑定中的 Prompt 会原子解绑全部平台、增加其 revision 并删除 Prompt；平台重新绑定前生成请求被服务端拒绝。
- [ ] 平台存在 `OPEN` 任务时不能硬删除且可以停用；没有 `OPEN` 任务时，历史任务与终态发布工作不阻止删除。
- [ ] 平台删除不会删除任何任务；历史任务和终态发布工作在实时平台/账号 ID 为空时仍显示创建快照。
- [ ] 仅被终态发布历史引用的账号可删除，非终态发布工作仍返回结构化阻断。
- [ ] 迁移后只存在 `SUCCESS + 白名单 action` 的历史审计；新低价值动作与失败/拒绝结果也不会重新写入。
- [ ] 全局审计清理不会改变任何业务表的行数或业务状态。
- [ ] 普通删除、永久删除、Prompt 解绑删除和平台删除在并发或中途失败时均保持事务原子性。

## Technical Notes

- 归档采用 `content_tasks.archived_at timestamptz NULL`；不增加第二套状态机。
- 平台和账号快照使用必要的标量列，不新增 JSONB 配置历史或通用快照框架。
- `content_tasks.platform_profile_id`、终态 `publication_works.platform_profile_id/platform_account_id` 在配置删除后可为空；创建任务和非终态发布工作仍要求实时配置存在。
- `geo_observation_publications.published_article_id` 随文章身份删除移除关系；`geo_observation_citations.published_article_id` 和下游来源外键置空并保留自身 URL/快照。
- 已验证文件继续走现有“解除关联后仅清理无引用文件”生命周期；共享文件不能因为任务永久删除而被误删。
- 本任务涉及公开 API、数据库迁移、权限和跨模块状态，属于复杂任务，必须以 `design.md` 和 `implement.md` 作为实施依据。
