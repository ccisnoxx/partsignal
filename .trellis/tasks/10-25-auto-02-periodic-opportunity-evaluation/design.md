# AUTO-02 设计

单份内部共享管理员配置，0068新geo_opportunity_schedule（id=1）拥有配置/status/revision/authorizer/next，geo_opportunity_schedule_windows拥有不可变COMPLETED/FAILED/MISSED和配置/规则快照。配置JSON不重复规则revision，后者独立FK到不可变规则表；显式转换为公共DTO。无旧数据回填、无默认启用、无模式/状态的前端推导。

Admin GET/PUT /api/v1/geo/opportunities/evaluation-schedule及activate/pause/resume子命令；GET可返回未配置revision0，PUT必须CAS（首次0），全局创建advisory锁避免首次竞争。User→Session→配置锁，动作由服务端投影。保存/启停重验最新ADMIN、CSRF/会话及规则存在；ACTIVE保存重设未来周期并重新授权，完全相同配置/同授权管理员无op。配置/status/授权实际变化revision+1，运行推进仅next变化。首次保存DISABLED，模式不借用MonitoringPlan或通用调度框架。

后台初读只确定authorizer/revision；随后User→配置锁并重读。共用current_actor_command及原评估共享核（手动wrapper保留commit、周期wrapper仅flush和明确SCHEDULED审计来源），原服务身份/规则/统计/机会去重/请求回执不另写一套。后台不继承HTTP会话，授权管理员必须仍启用、ADMIN且无改密门禁；成功机会/回执/窗口/next同事务。固定UTC周期，窗口结束为scheduled_for；延迟时计算最近一个到期窗口，先前区间标MISSED，不集中追赶。每次扫描仅一份配置、最多一次评估，复用恢复扫描间隔和两项总开关。

已有身份/评估上下文在异常时会rollback整个事务，不能假装仍在savepoint中记录失败。因此失败后另开User→配置锁事务，只有revision/授权/旧next均未变且窗口未完成才写FAILED与未来next；竞争或暂停先赢则不覆盖，保留运维错误。提交确认丢失时同样重读窗口和next，不能把真实COMPLETED改成FAILED。未知错误只存EVALUATION_FAILED并记录ID/类型，不保存原始异常/SQL/回答。开关关闭不推进；每次失败尝试最多一次，不循环重试同窗口。

配置变更/暂停若旧next已到期，记录SUPERSEDED半开区间；启用/恢复下一周期为max(DB now,已处理时点/区间终点)+interval，避免时钟回拨。窗口PK(schedule_id,scheduled_for)，COMPLETED强制引用实际不可变手动评估回执，核对规则、窗口日期和筛选快照；窗口不可修改/删除/truncate。配置ACTIVE⇔next非空，身份和配置revision守卫。新authorizer FK接入User引用/删除策略，新增配置审计白名单和前端展示，不把定时执行说成手动点击。

前端独立管理员面板，按需读取不执行；复用现有EvaluationOptions/collection mode/未生成原因展示。RHF/Zod保存明确范围和周期，冻结编辑revision，409/背景配置变更必须显式读取后再确认。状态命令CAS，未知结果只重读不自动重放。主体/卸载/迟到读取、重复提交和接受后刷新失败有清晰边界；ACTIVE展开面板前台读取运行进展，显示实际统计和机会导航。保留原手动评估入口。

0068加法迁移；回退先暂停新增扫描并保留配置/窗口/机会历史，降级55000停止，采用前向修复。仅本地PG及必要定向验证，禁止线上或提交推送。
