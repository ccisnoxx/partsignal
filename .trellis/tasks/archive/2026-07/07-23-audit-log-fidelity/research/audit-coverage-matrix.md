# 审计覆盖矩阵

## 口径

- “成功覆盖”表示业务服务在成功事务内追加现有 `audit_logs` 记录。
- “失败”表示已认证请求进入业务命令后因校验、状态、并发或外部调用失败；请求体解析失败不视为业务命令。
- “拒绝”特指已认证用户因账号类型无权执行命令；未登录、会话失效和 CSRF 失败保留在访问日志，不写业务审计。
- 当前九类操作均没有统一 `outcome` 字段；“未覆盖”不能由 HTTP 访问日志或前端错误提示代替。

## 实施前基线矩阵

| 业务模块 / 关键操作 | 服务端权威调用点 | 操作人来源 | 对象 | 结果覆盖 | 请求 ID | 非敏感摘要 | 当前结论 | 最小修改位置 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 配置中心 / 更新或启停平台配置 | `platform_configuration.update_platform_profile`：`backend/app/services/platform_configuration.py:535-560`；启停：`:284-313` | 管理员依赖注入的 `actor.id` | `PlatformProfile` / 路径 ID | 成功：`platform_profile.updated|enabled|disabled`；失败/拒绝：无 | 成功有 | 只有类型 ID、启停状态、revision；没有旧值和允许域名数量变化 | 部分覆盖 | 服务内补安全 before/after；对应路由接失败/拒绝终态审计 |
| 配置中心 / 激活平台规则版本 | `content_planning.activate_platform_profile_version`：`backend/app/services/content_planning.py:221-291` | 管理员 `actor.id` | `PlatformProfileVersion` / 路径 ID | 成功：新版本 `activated`，旧版本 `retired`；失败/拒绝：无 | 成功有 | reason、替代版本、revision、comment；自由文本 comment 目前仅黑名单检查 | 部分覆盖 | 保留双事件同事务；摘要改白名单结构；命令失败/拒绝单独留痕 |
| 配置中心 / 保存 Prompt | `platform_configuration.put_platform_prompt`：`backend/app/services/platform_configuration.py:400-445` | 管理员 `actor.id` | `PlatformProfile` / 路径 ID | 成功：`platform_prompt.saved`；失败/拒绝：无 | 成功有 | 只记录 revision，未记录 Prompt 正文，安全但无新建/更新状态变化 | 部分覆盖 | 只记录“是否已配置”和 revision 的前后值；禁止正文进入审计 |
| 内容审核 / 通过或退回内容 | `review.transition_content_version`：`backend/app/services/review.py:306-369` | 工程师或管理员 `actor.id` | `ContentVersion` / 路径 ID | 成功：`content_version.approve|request-changes|submit-review`；失败/拒绝：无 | 成功有 | 新状态和 revision；旧状态可在锁定行上真实读取但当前未保存 | 部分覆盖 | 服务内保存真实状态变化；对应路由记录业务失败/账号类型拒绝 |
| 发布管理 / 登记发布结果 | 创建：`backend/app/services/publication.py:144-218`；状态命令：`:260-351` | 工程师或管理员 `actor.id` | `PublicationRecord` / 已创建或路径 ID | 成功：`publication.created`、`publication.{command}`；失败/拒绝：无；幂等重放不重复写 | 成功有 | 状态、部分关联 ID；不含标题/URL/截图正文 | 部分覆盖 | 保持幂等不重复；状态命令补真实前后状态；失败创建允许对象 ID 为空 |
| GEO 观测 / 新增观测记录 | `geo_observation.create_geo_observation`：`backend/app/services/geo_observation.py:1511-1599` | 工程师或管理员 `actor.id` | `GeoObservation` / 成功后新 ID | 成功：`geo_observation.created`；失败/拒绝：无 | 成功有 | 仅 supersedes_id，不保存搜索结果、备注或第三方内容 | 部分覆盖 | 成功补安全关系计数；失败创建允许对象 ID 为空，不记录请求正文 |
| 发布账号 / 删除或停用账号 | 删除：`publication.delete_platform_account`：`backend/app/services/publication.py:109-141`；未发现启停命令 | 管理员 `actor.id` | `PlatformAccount` / 路径 ID | 删除成功有；失败/拒绝无；停用/启用无业务 API | 成功有 | 删除记录无摘要 | 删除覆盖、启停缺失 | 本任务以现有删除事件满足原型；除非另行批准，不新增账号启停业务命令 |
| 用户管理 / 停用或启用用户 | `identity` 用户更新：`backend/app/services/identity.py:275-334` | 管理员 `actor.id` | `User` / 路径 ID | 成功：`user.updated`；失败/拒绝：无 | 成功有 | 变更后的 display_name/account_type/is_active，批量来源和状态；无旧值 | 部分覆盖 | 复用已读取的 previous 值形成白名单 changes；补失败/拒绝终态 |
| 产品事实 / 提交事实审核 | `review.transition_fact_version`：`backend/app/services/review.py:255-303` | 工程师或管理员 `actor.id` | `FactVersion` / 路径 ID | 成功：`fact_version.submit-review`；失败/拒绝：无 | 成功有 | 新状态和 revision，不含完整事实快照 | 部分覆盖 | 服务内补真实旧/新状态；对应路由记录业务失败/账号类型拒绝 |

## 覆盖汇总

- 成功事件：九类提示均有现有事件可复用，不需要发明 action；平台账号采用已存在的删除事件。
- 失败事件：九类均无统一覆盖；AI 模型测试和模型发现是系统内局部先例，见 `backend/app/services/ai_configuration.py:740-821`，但结果仍塞在 `details`，不是全局契约。
- 拒绝事件：账号类型检查在 `backend/app/deps.py:84-98` 的路由依赖阶段抛出，当前没有业务事件上下文，九类均未覆盖。
- 请求 ID：所有现有成功调用点都从请求上下文传入；客户端提供值未经长度/字符校验，可能超过数据库 `VARCHAR(100)`。
- 摘要：现有载荷普遍只记录“新状态/revision/关联 ID”，不能满足原型完整 before/after；计划只补调用点已经真实读取的值，不回查当前对象重算历史。
- 平台账号停用：数据模型存在 `is_active`，但没有查到显式状态命令；本任务不把一个不存在的业务操作当成“缺失审计”自行实现。

## 推荐分步边界

1. 本任务：给全局审计记录增加统一模块、结果和安全说明契约；九类关键命令补成功摘要及可审计的业务失败/账号类型拒绝。
2. 后续任务：按风险和使用频率把相同失败/拒绝边界扩展到其余写命令；不在本任务一次性改造所有路由。
3. 长期不做：前端事件、第二张审计表、通用事件总线或根据 HTTP 状态猜测业务审计。

## 实施后覆盖

| 九类批准范围 | 成功 | 失败 | 拒绝 | 请求 ID 与摘要 |
| --- | --- | --- | --- | --- |
| 更新或启停平台配置 | 同业务事务 `SUCCESS` | 回滚后独立 `FAILED` | 回滚后独立 `DENIED` | 真实请求 ID；启停、配置状态与 revision 白名单 |
| 激活平台规则版本 | 同业务事务 `SUCCESS` | 回滚后独立 `FAILED` | 回滚后独立 `DENIED` | 真实请求 ID；版本状态与替代关系白名单 |
| 保存 Prompt | 同业务事务 `SUCCESS` | 回滚后独立 `FAILED` | 回滚后独立 `DENIED` | 只记录配置状态和 revision，不记录正文 |
| 内容审核通过或退回 | 同业务事务 `SUCCESS` | 回滚后独立 `FAILED` | 回滚后独立 `DENIED` | 真实请求 ID；状态变化白名单 |
| 登记发布及发布状态命令 | 同业务事务 `SUCCESS` | 回滚后独立 `FAILED` | 回滚后独立 `DENIED` | 创建失败允许空对象 ID；不记录标题、URL 或正文 |
| 新增 GEO 观测 | 同业务事务 `SUCCESS` | 回滚后独立 `FAILED` | 回滚后独立 `DENIED` | 创建失败允许空对象 ID；只记录关系计数和安全事实 |
| 删除发布账号 | 同业务事务 `SUCCESS` | 回滚后独立 `FAILED` | 回滚后独立 `DENIED` | 真实路径对象 ID；不新增不存在的账号启停 API |
| 停用或启用用户 | 同业务事务 `SUCCESS` | 回滚后独立 `FAILED` | 回滚后独立 `DENIED` | 单个与批量均记录真实目标、来源、状态和 revision |
| 提交产品事实审核 | 同业务事务 `SUCCESS` | 回滚后独立 `FAILED` | 回滚后独立 `DENIED` | 真实请求 ID；事实版本状态变化白名单 |

以上失败/拒绝事件都由对应业务路由捕获已认证命令的 `AppError`，先回滚原事务，再以同一数据库引擎的独立短事务追加审计。请求解析、身份认证、会话和 CSRF 失败继续只进入访问日志；其他既有写命令暂时保持成功审计，等待后续任务扩展。
