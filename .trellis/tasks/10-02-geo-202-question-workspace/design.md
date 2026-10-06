# GEO-202 设计

PromptVariant 为可变聚合唯一所有者，沿用 GEO-201 历史冻结。命令按 User→Topic→Variant 取锁；User 使用 FOR NO KEY UPDATE，兼容既有主题成功审计 actor 外键的 KEY SHARE，仍阻止资格更新和删除。舍弃认证待写的同 actor Session.last_seen_at 活动提示，避免与同 Cookie 改密形成 Session/User 锁环；不修改 expires_at、revoked_at 或认证/CSRF规则。创建者锁后复核资格，变体 topic 绑定不可变。读取在认证前建立 RR、关闭 autoflush，单 join 返回详情，列表 count/page 固定查询。

公共 create 沿用 query_topic_id，嵌套路由要求 body/path 相同，冲突返回422。服务端投影 ACTIVE/DISABLED/REFERENCED、UPDATE/ENABLE/DISABLE/DELETE/COPY、primary_task 和 HISTORY_REFERENCE，不提供虚构 Plan/Run 计数。run_entry.available=false、NOT_IMPLEMENTED 表示能力未开放；不新增运行端点。

前端 /geo/questions 保留旧 /geo/topics；详情已含当前主题摘要，主题选项只选择身份，不拼装业务快照。复制只作新建表单的初始值，新身份仍受语义唯一约束；未保存草稿不进 URL/Query。409及后台读取保留输入，显式GET合并提交revision后由用户再次确认，不自动重放；dirty/principal/unmount守卫保留异步意图。同资源动作不重挂详情实例。

本任务验收 AC-TOPIC-02/03 的变体切片；空主题及最后变体停用可配置。至少一个活动变体的使用门禁留给计划/运行任务，本次不宣称完整 AC-TOPIC-02 达成。
