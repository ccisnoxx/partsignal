# GEO-703 设计与冻结协议

## 边界与文档裁决
唯一依赖 GEO-702 已由用户接受，manifest done / Trellis completed；README 概览旧 review 不覆盖 manifest。PRD 关于确认也需要原因的孤立文案与业务状态机/702已接受合同不一致：按 README 文档优先级采用业务状态机，acknowledge 只需 expected_revision；dismiss 必须 resolution_code / resolution_comment trim 非空。resolve 仍属706；不新增负责人列、行动写入、复测、评估 HTTP、自动关闭或规则恢复推断。

## HTTP
- GET /api/v1/geo/opportunities → GeoOpportunityListPage；operationId listGeoOpportunities。
- GET /api/v1/geo/opportunities/{opportunity_id} → GeoOpportunityDetail；getGeoOpportunity。
- POST 同路径 /acknowledge → GeoOpportunityListItem；acknowledgeGeoOpportunity；GeoOpportunityRevisionRequest {expected_revision: integer >=1}。
- POST 同路径 /dismiss → GeoOpportunityListItem；dismissGeoOpportunity；GeoOpportunityDismissRequest {expected_revision, resolution_code: trim非空1..40, resolution_comment: trim非空1..2000}；禁止NUL。
- GET权限ADMIN/ENGINEER、RR禁autoflush，详情no-store；POST CSRF、同角色、RC锁后重验。无开关阻断历史读取/人工处理。
- 列表 query：q, status, priority, rule_code, subject_id, product_id, query_topic_id, prompt_variant_id, collection_profile_id, engine_surface_id, collection_mode, created_from/to（带时区半开）, sort PRIORITY_DESC/CREATED_DESC/LAST_SEEN_DESC；page≥1/page_size=10|20|50。排序包含created_at/id确定性tie-break。空白q视为无搜索，不把原因/原始正文纳入搜索。
- 详情 query：source_page≥1、source_page_size=10|20|50。分页及总数来自机会来源表，与首次trigger snapshot区分。

## 响应
GeoOpportunityListItem：id/rule_code/priority/status/revision、scope、服务端title/description、当前关联维度显示名及product_id（明确当前元数据）、value/threshold/numerator/denominator（首次trigger）、source_date_from/to、created_at/last_seen_at、acknowledged_at/by、resolved_at/by、resolution_code/comment、source_count/action_count；workflow_stage OPEN|ACKNOWLEDGED|IN_PROGRESS|CLOSED、primary_task ACKNOWLEDGE|VIEW_EVIDENCE、available_actions ACKNOWLEDGE|DISMISS。
GeoOpportunityListPage：items,total,page,page_size,as_of,filter_options；filter_options提供subject/product/topic/prompt/profile/surface命名选项（当前机会记录引用集合，不依赖当前筛选，不隐含激活资格）。
GeoOpportunityDetail：opportunity列表项、trigger_snapshot、latest_evaluation（按opportunity_id的最新已关联记录，包含id/rule_set_revision/evaluated_as_of/created_at/disposition/result_snapshot）、sources分页、actions已有只读记录、as_of。
GeoOpportunitySourceEvidence：来源id/run_id/analysis_revision_id/review_id/source_role/created_at；run公共冻结输入；answer/citations/evidence_files；所绑定历史analysis/review/effective_results。缺关联显式409，不以当前pointer回退。原始文件保持已有完整性/访问级别/受控签名政策，503表示签名依赖不可用。

## 状态、事务和审计
状态映射由唯一现有policy派生，只投影703命令：OPEN→ACKNOWLEDGED；OPEN/ACKNOWLEDGED/IN_PROGRESS→DISMISSED；其他状态无动作。命令重用现有User锁入口，锁序User NO KEY UPDATE→Opportunity FOR UPDATE；populate_existing清除旧identity map观测；锁后检查expected_revision，非法动作409。ack保存服务器actor/time；dismiss保存close actor/time及两段原因；revision每次+1，last_seen_at保持评估时间，首次快照/来源不改。命令与低敏成功审计同一事务提交，任何失败rollback；不吞SQL错误，不自动重试，不用幂等key把旧revision伪装成功。审计仅revision/status，不含原因、答案或签名URL。

## 前端
/geo/opportunities；URL字段与API同名，选中机会 opportunity_id，来源 source_page/source_page_size。generated OpenAPI是唯一传输类型；domain query keys包含所有条件并传递AbortSignal。列表、Drawer、命令服务端投影直接消费；成功更新返回项并失效查询；409保留草稿，显式刷新到新revision后再提交，不自动重放。只显示真实可用动作。关闭Drawer清理选中参数并恢复焦点；历史/刷新恢复分页筛选。首载/空页/错误/后台失败/权限/404/证据409或503均有可操作状态；签名URL和原因不进入URL、持久浏览器存储或客户端日志。

## 数据与验证
0059已具备全部列、索引、转移守卫、不可变来源和审计事务能力，无新Alembic或历史数据回填。共享分析批量加载与文件签名保留唯一所有者，复用Run详情既有行为并运行其定向回归。精确测试涵盖权限/CSRF、revision并发单赢家、审计rollback、历史review固定、筛选分页、URL/Drawer/409草稿及真实API流程。用户要求的完整门禁执行并保留每项argv/exit_code/log；环境失败不冒充通过。
