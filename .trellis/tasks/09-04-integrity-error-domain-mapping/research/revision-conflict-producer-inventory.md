# Research: REVISION_CONFLICT 生产者清单

- Query: 独立复核 backend/app/services 中每个显式 AppError("REVISION_CONFLICT", ...) 生产者，逐语法点映射函数与 operationId，并按真实 expected_revision/current revision、合同批准的 snapshot/context stale、明确误用、待合同决策分类；说明与 IntegrityError 全局 scope 的关系。
- Scope: internal
- Date: 2026-09-04

## Findings

### 1. 计数与分类口径

全文搜索 backend/app/services/*.py 中的 raise AppError("REVISION_CONFLICT"...)，排除 identity.py:56 的错误码注册常量后，共得到 62 个语法生产点，分布于 9 个 service 文件：

| 分类 | 语法点数 | 说明 |
|---|---:|---|
| expected_revision / current revision mismatch | 46 | 真实行锁对象或聚合 revision 与请求 expected_revision 不一致；其中共享 helper 的一处语法点可被多个 operationId 调用 |
| 现有合同批准的 snapshot/context stale | 2 | AI 外部调用前后按合同复核渠道/模型 revision，丢弃过期远端结果 |
| 明确误用 | 2 | createUser 的 username 唯一冲突预检；自然化 Prompt 不存在却使用 REVISION_CONFLICT |
| 待合同决策 | 12 | GEO 更正链断裂、分支、类型不一致、已存在后继等稳定 409，但当前合同没有批准这些语义使用 REVISION_CONFLICT |
| 合计 | 62 | 仅统计 service 中显式 AppError 构造语法，不统计全局 IntegrityError handler 或其它错误码 |

按调用命令合并后，这 62 个语法点覆盖 68 个 operationId：共享情况包括 identity._update_user_locked（2 个）、GEO detail chain helper（2 个）、publication._lock_work（6 个）、review 两个 transition helper（各 3 个）、AI/平台启停 helper（各 2 个）。因此“语法生产点”与“HTTP 命令投影”不能混为一个数字。

### 2. 逐语法点清单

#### Identity（4 个语法点；3 expected、1 明确误用）

| 位置 / 函数 | operationId | 分类与证据 |
|---|---|---|
| backend/app/services/identity.py:403，create_user | createUser（router identity.py:224-231） | 明确误用：重复 username 预检返回 REVISION_CONFLICT。该业务实际对应 User.username unique（models/identity.py:36 附近），当前错误码应由唯一冲突领域合同决定，不能视为 revision 过期；最终 flush :412 还可能进入全局 IntegrityError handler。 |
| identity.py:448，_update_user_locked | updateUser、bulkUpdateUserStatus（调用方 identity.py:534-554,557-594；routers identity.py:244-250,313-319） | expected_revision：锁定 User 后比较 user.revision 与请求项 revision。bulk operation 对此 AppError 按允许的逐项失败收集，命令仍可提交其它成功项。 |
| identity.py:611，delete_user | deleteUser（router identity.py:338-344） | expected_revision：删除前锁定用户并比较 revision；随后还校验停用状态、业务引用和 FK。 |
| identity.py:667，reset_user_password | resetUserPassword（router identity.py:362-368） | expected_revision：锁定目标 User 后比较 payload.expected_revision。 |

#### Product / facts（4 个语法点；全部 expected/current revision）

| 位置 / 函数 | operationId | 分类与证据 |
|---|---|---|
| backend/app/services/product_facts.py:440，update_product | updateProduct（router product_facts.py:159-165） | expected_revision：Product.revision 与 update payload 不匹配。 |
| product_facts.py:501，delete_product | deleteProduct（router product_facts.py:181-188） | expected_revision：锁定 Product 后比较删除请求 revision。 |
| product_facts.py:648，replace_product_facts | replaceProductFactsDraft（router product_facts.py:219-227） | current revision：Product.facts_revision 与草稿保存请求 expected_revision 不匹配。 |
| product_facts.py:675，submit_fact_review | submitProductFactReview（router product_facts.py:284-295） | current revision：提交审核前再次比较同一 facts workspace revision。 |

#### Content planning（2 个语法点；全部 expected/current revision）

| 位置 / 函数 | operationId | 分类与证据 |
|---|---|---|
| backend/app/services/content_planning.py:241，update_query_topic | updateQueryTopic（router planning.py:153-164） | expected_revision：锁定 QueryTopic 后比较请求 revision。 |
| content_planning.py:277，delete_query_topic | deleteQueryTopic（router planning.py:177-189） | expected_revision：删除前锁定并比较 QueryTopic revision。 |

#### Review service（2 个语法点；覆盖 6 个命令，全部 expected/current revision）

| 位置 / 函数 | operationId | 分类与证据 |
|---|---|---|
| backend/app/services/review.py:300，transition_fact_version | approveFactVersion、requestFactVersionChanges、retireFactVersion（router product_facts.py:386-447） | expected_revision：事实版本状态命令锁定 FactVersion 并比较请求 revision。 |
| review.py:357，transition_content_version | submitContentVersion、approveContentVersion、requestContentVersionChanges（router production.py:544-607） | expected_revision：内容版本状态命令锁定 ContentVersion 并比较请求 revision。 |

#### Platform configuration（9 个语法点；8 expected、1 明确误用）

| 位置 / 函数 | operationId | 分类与证据 |
|---|---|---|
| backend/app/services/platform_configuration.py:359，set_platform_profile_enabled | enablePlatformProfile、disablePlatformProfile（router configuration.py:652-675） | expected_revision：锁定平台 profile 后比较请求 revision。 |
| platform_configuration.py:493，update_platform_type | updatePlatformType（router configuration.py:380-399） | expected_revision：锁定 PlatformType 后比较 revision。 |
| platform_configuration.py:517，delete_platform_type | deletePlatformType（router configuration.py:407-418） | expected_revision：删除前比较 PlatformType revision。 |
| platform_configuration.py:673，update_platform_prompt | updatePlatformPrompt（router configuration.py:536-551） | expected_revision：锁定 Prompt 后比较 payload revision。 |
| platform_configuration.py:763，put_content_humanization_prompt | putContentHumanizationPrompt（router configuration.py:325-336） | 明确误用：自然化 Prompt 尚不存在却返回 REVISION_CONFLICT；“不存在”不是 revision mismatch，应由 NOT_FOUND/专门合同错误决定。 |
| platform_configuration.py:772，put_content_humanization_prompt | putContentHumanizationPrompt | expected_revision：singleton Prompt 已存在时比较其 revision；同一个函数包含上一行的“尚不存在”误用和此处真实 revision 分支。 |
| platform_configuration.py:813，delete_platform_prompt | deletePlatformPrompt（router configuration.py:560-575） | expected_revision：删除 Prompt 前比较 revision。 |
| platform_configuration.py:865，update_platform_profile | updatePlatformProfile（router configuration.py:607-623） | expected_revision：锁定 Profile 后比较 revision。 |
| platform_configuration.py:918，delete_platform_profile | deletePlatformProfile（router configuration.py:686-701） | expected_revision：删除 Profile 前比较 revision。 |

#### AI configuration（14 个语法点；12 expected、2 合同批准的 snapshot/context stale）

| 位置 / 函数 | operationId | 分类与证据 |
|---|---|---|
| backend/app/services/ai_configuration.py:524，delete_ai_channel | deleteAIChannel（router configuration.py:903-918） | expected_revision：锁定渠道并比较 required revision。 |
| ai_configuration.py:555，create_ai_channel_header | createAIChannelHeader（router configuration.py:967-983） | expected_revision：新增 Header 仍要求并复核所属渠道 revision。 |
| ai_configuration.py:611，update_ai_channel_header | updateAIChannelHeader（router configuration.py:992-1007） | expected_revision：所属渠道 revision mismatch。 |
| ai_configuration.py:661，delete_ai_channel_header | deleteAIChannelHeader（router configuration.py:1016-1031） | expected_revision：所属渠道 revision mismatch。 |
| ai_configuration.py:729，delete_ai_model | deleteAIModel（router configuration.py:1189-1204） | expected_revision：锁定 channel -> model 后比较模型 revision。 |
| ai_configuration.py:761，update_ai_channel | updateAIChannel（router configuration.py:802-817） | expected_revision：渠道 revision mismatch。 |
| ai_configuration.py:815，replace_ai_channel_api_key | replaceAIChannelApiKey（router configuration.py:826-841） | expected_revision：渠道 revision mismatch。 |
| ai_configuration.py:852，set_channel_enabled | enableAIChannel、disableAIChannel（router configuration.py:869-900） | expected_revision：启停命令在锁内比较渠道 revision；同态目标另走 INVALID_STATE_TRANSITION。 |
| ai_configuration.py:892，update_ai_model | updateAIModel（router configuration.py:1085-1100） | expected_revision：锁定 channel -> model 后比较模型 revision。 |
| ai_configuration.py:935，test_ai_model | testAIModel（router configuration.py:1110-1125） | expected_revision：真实外部调用前比较模型 revision。 |
| ai_configuration.py:964，test_ai_model | testAIModel | 现有合同批准的 snapshot/context stale：外部测试返回后按渠道和模型 snapshot revision 复核；配置已变化则不写测试结果并返回 REVISION_CONFLICT。依据 .trellis/spec/backend/ai-configuration-guidelines.md:36,168-170。 |
| ai_configuration.py:987，discover_ai_channel_models | discoverAIChannelModels（router configuration.py:930-941） | expected_revision：外部发现调用前比较渠道 revision。 |
| ai_configuration.py:1013，discover_ai_channel_models | discoverAIChannelModels | 现有合同批准的 snapshot/context stale：Provider 返回后复核渠道 revision；变化则丢弃远端模型结果、不落库、不审计，依据 .trellis/spec/backend/ai-configuration-guidelines.md:168。 |
| ai_configuration.py:1032，set_model_enabled | enableAIModel、disableAIModel（router configuration.py:1155-1187） | expected_revision：锁定模型后比较模型 revision；同态目标另走 INVALID_STATE_TRANSITION。 |

#### Publication（12 个语法点；全部 expected/current revision，覆盖 18 个 operationId）

| 位置 / 函数 | operationId | 分类与证据 |
|---|---|---|
| backend/app/services/publication.py:301，update_platform_account | updatePlatformAccount（router publication.py:228-243） | expected_revision：锁定平台账号后比较 account revision。 |
| publication.py:329，set_platform_account_enabled | enablePlatformAccount、disablePlatformAccount（router publication.py:263-307） | expected_revision：启停账号前比较 account revision。 |
| publication.py:347，delete_platform_account | deletePlatformAccount（router publication.py:324-340） | expected_revision：删除账号前比较 account revision，再复核非终态发布引用。 |
| publication.py:464，_lock_work | switchPublicationContentVersion、updatePublicationPreparation、markPublicationPlatformReview、registerPublicationResult、verifyPublicationWork、closePublicationWork（调用点 publication.py:567,618,650,676,725,809；router operation 定义 publication.py:429-562） | expected_revision：共享工作锁 helper 比较 PublicationWork revision；6 个命令共用一个语法点。 |
| publication.py:896，create_repair_task | createPublishedContentRepairTask（router publication.py:757-776） | expected_revision：锁定 PublishedContentIssue 后比较 payload.expected_issue_revision。 |
| publication.py:963，resolve_published_content_issue | resolvePublishedContentIssue（router publication.py:785-813） | expected_revision：问题状态变更前比较 issue revision。 |
| publication.py:1108，permanently_delete_published_article | permanentlyDeletePublishedArticle（router publication.py:639-654） | expected_revision：按成果工作 revision 复核永久删除请求。 |
| publication.py:1476，archive_content_task | archiveContentTask（router planning.py:422-435） | expected_revision：锁定 ContentTask 后比较 revision。 |
| publication.py:1491，restore_content_task | restoreContentTask（router planning.py:443-456） | expected_revision：锁定任务后比较 revision。 |
| publication.py:1514，cancel_content_task | cancelContentTask（router planning.py:397-411） | expected_revision：取消前比较任务 revision。 |
| publication.py:1546，delete_content_task | deleteContentTask（router planning.py:373-388） | expected_revision：删除完整任务聚合前比较 revision。 |
| publication.py:1605，permanently_delete_content_task | permanentlyDeleteContentTask（router planning.py:478-492） | expected_revision：永久删除归档任务前比较 revision。 |

#### Content production（3 个语法点；全部 expected/current revision）

| 位置 / 函数 | operationId | 分类与证据 |
|---|---|---|
| backend/app/services/content_production.py:777，update_content_draft | updateContentDraft（router production.py:409-425） | expected_revision：锁定 ContentVersion 后比较请求 revision。 |
| content_production.py:838，delete_content_draft | deleteContentDraft（router production.py:434-450） | expected_revision：删除草稿前比较 revision。 |
| content_production.py:902，abandon_content_version | abandonContentVersion（router production.py:516-531） | expected_revision：放弃内容版本前比较 revision。 |

#### GEO observation（12 个语法点；全部待合同决策）

| 位置 / 函数 | operationId | 分类与现有合同证据 |
|---|---|---|
| backend/app/services/geo_observation.py:904,928,938,946,950，_manual_observation_chain | getGeoObservationDetail、getGeoObservationCorrectionContext（detail 调用点 geo_observation.py:997,1103；router observation.py:261-288） | 待合同决策：递归链无唯一 root、目标缺失、节点字段不一致、分支或链尾数量不一致都返回 REVISION_CONFLICT。contracts/database.md:147 和 .trellis/spec/backend/database-guidelines.md:610-611 只批准“缺少链/不完整或分支链返回稳定 409”，未批准具体使用 REVISION_CONFLICT；候选应是 context-incomplete/专门 GEO code。5 个语法点由同一 read helper 覆盖两个 operationId。 |
| geo_observation.py:1029，get_geo_observation_detail | getGeoObservationDetail | 待合同决策：Detail 输出投影类型不是 ManualGeoObservationOut 时返回 REVISION_CONFLICT；这是 context projection invariant 失败，不是 expected_revision。 |
| geo_observation.py:2428，create_geo_observation | createGeoObservation（router observation.py:333-347） | 待合同决策：更正目标已经有后继时返回 REVISION_CONFLICT。合同只规定“已有后继”返回 409、来源保持不变（database-guidelines:610），没有批准 revision code；应考虑专门 stale/已有后继 code。 |
| geo_observation.py:2435，create_geo_observation | createGeoObservation | 待合同决策：补证据时沿 supersedes 链发现父节点缺失；属于 context incomplete，当前 REVISION_CONFLICT 不是已批准的 expected_revision。 |
| geo_observation.py:2509,2532,2539,2553，_lock_manual_observation_chain | deleteGeoObservation（调用点 geo_observation.py:2598；router observation.py:294-306） | 待合同决策：删除前发现祖先链断裂、后继分支、节点类型/产品不一致或锁定后链集合变化。合同允许删除不完整/分支链返回 409 或 DB 55000（database-guidelines:611），但没有批准 REVISION_CONFLICT 作为 wire code。4 个语法点由 delete helper 覆盖一个 operationId。 |

### 3. 与 IntegrityError scope 的关系

- 显式 REVISION_CONFLICT 是 service 主动抛出的领域错误，通常发生在查询/行锁后的 precheck；它不经过 IntegrityError handler，也不依赖数据库异常。
- 真实 expected_revision 过期的 46 个语法点应保留 409 REVISION_CONFLICT，并在任何写入、审计、事件或 revision 递增前失败。contracts/database.md:117,367 及相关 backend specs 对 stale revision 明确要求此 code。
- createUser 的 identity.py:403 是明确误用：它是 username unique 预检查，与本次 IntegrityError 审计中的最终 db.flush():412 同一约束路径；并发下第二请求可能绕过预检查，在 flush 触发 uq_users_username，再被全局 errors.py:76-78 错误返回 REVISION_CONFLICT。预检查和全局异常因此形成同一错误域的两个错误 owner。
- GEO 的 12 个语法点不是数据库 IntegrityError，但它们与“约束/上下文完整性”有关；不能为了统一视觉路径把所有稳定 409 都标作 revision。当前合同只批准了 409 及不部分写入，wire code 需补充合同决策。
- AI test/discover 的 2 个 snapshot/context stale 是显式批准的非普通行写入竞争：合同要求外部调用后复核 revision，丢弃远端结果、不写测试/发现结果、不审计；这两个点仍应保留 REVISION_CONFLICT，但不得与数据库唯一/FK/CHECK 冲突混同。
- 本清单不包括全局 handler 产生的 REVISION_CONFLICT，也不包括 in_use、INVALID_STATE_TRANSITION、GEO_PUBLICATIONS_CHANGED 等其它 code。上一份 backend-integrity-paths.md 已统计全局 IntegrityError handler 和未捕获 flush/commit 路径；两份研究合起来可区分“主动领域生产者”和“数据库异常被动映射”。

### 4. 总结建议

1. 将真实 expected_revision/current revision 的 46 个语法点作为唯一批准的 REVISION_CONFLICT service owner；维持锁定、比较、失败前不写审计/事件/修订的顺序。
2. 将 AI test/discover 的 2 个调用后复核点作为合同批准的 snapshot/context stale 特例；不要把其结果写入或用数据库 IntegrityError 兼容处理。
3. 对 identity.create_user 重复 username、platform_configuration.put_content_humanization_prompt 不存在分别移出 REVISION_CONFLICT；前者应与已确认 username unique 的领域映射统一，后者应由资源不存在合同决定。
4. 对 GEO 12 个点先补充稳定 code/status 归属决策；在决策前不要批量改码或把 context invariant 继续扩张为 revision。
5. IntegrityError 的 unknown constraint 仍应原样失败；不能让全局 409 或主动 REVISION_CONFLICT 掩盖数据库唯一、FK、CHECK 和真实 revision stale 的差别。

## Caveats / Not Found

- 这是静态独立 review；未执行 HTTP、并发写入、真实 PostgreSQL 或外部 AI 调用，未改变代码。
- operationId 依据 backend/app/routers 中的显式 operation_id 和 service import/call 链映射；同一 service helper 被多个 route 复用时已在表中展开。
- “待合同决策”不表示实现一定错误，而是现有合同只证明了 409 或上下文失败语义，没有找到批准 REVISION_CONFLICT 这一具体 wire code 的证据。
- 未将 errors.py:78 的全局 IntegrityError -> REVISION_CONFLICT 计入 62 个主动生产点；它属于上一份 IntegrityError 路径审计的被动 producer。

