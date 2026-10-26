# 设计

新增POST /api/v1/geo/observation-runs/{run_id}/reanalyze，AdminUser+CSRF，闭合{expected_revision>=0, reason}，reason沿原RULES_UPDATED/DICTIONARY_UPDATED/FACTS_UPDATED/RETRY_FAILED。200返回{run_id,analysis_revision_id,request_id}，可复用已存在的PENDING/COMPLETED同hash版本，不返回虚构created/replayed或计算完成状态。路由不取得第二套写事务，复用服务原User→Batch→Run与冻结/审计/派发。

闭合原因移至Schema唯一所有者，服务继续直接使用同枚举。纯reanalyzable(status,collected)提为策略，命令和详情复用；现有get_run已保证collected时有Answer。GeoRunAnalysisDetail.available_actions增加REANALYZE，只投影当前ADMIN/active/非改密/开关及合法状态/保有回答，不改采集动作/主任务或指标规则，不增加逐行查询。

不新增幂等存储或借用审计构造状态模型。原命令同输入去重不等于HTTP请求幂等：重试时当前字典可能变化。未知结果只带原原因/请求ID显示诊断、重读现有分析历史供人工核对，不用新增ID差集或复用ID推断原请求成功；明确关闭核对后才可再发起新请求。

前端局部RHF/Zod表单按服务端token展示，冻结Run revision及分析身份/状态基线；背景变化暂停，显式刷新后重确认。成功先保留稳定回执，再取消旧读取并失效Run及洞察/报告；刷新失败不重发。目标版本状态由原详情取得并链接原历史。只要分析历史有PENDING，终态Run详情仍5秒轮询，错误/后台不轮询，不新增调度或跨页推送。首次观察到本次目标终态（包括首次读取已完成）后，仅再取消/失效洞察与报告一次，避免接受时早读的30秒fresh缓存；不再次失效Run。回执展示及焦点由独立ReanalysisReceipt拥有。

无数据库迁移或线上配置；回退本轮API/UI/投影即可，既有分析和审计保留。
