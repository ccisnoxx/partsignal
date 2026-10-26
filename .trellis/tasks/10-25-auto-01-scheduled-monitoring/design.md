# 设计与合同

扩展GEO-1005人工优先边界，仅显式新建的CRON登记geo_plan_schedules；无回填，历史CRON仍UNSUPPORTED_SCHEDULE/只读。MANUAL与CRON模式创建后不互转，避免修订隐式开启或取消调度；可新建不同模式计划。复制已登记CRON形成独立DISABLED计划；历史CRON仍不可复制。

Plan拥有配置与ACTIVE/PAUSED/ARCHIVED；geo_plan_schedules拥有next_run_at游标，已登记CRON提交态强制ACTIVE ⇔ next_run_at非空，启用时计算未来窗口；不为运行推进增加Plan revision。新geo_plan_schedule_windows追加不可变终态CREATED/FAILED/MISSED，PK(plan_id,scheduled_for)，包含plan_revision、batch_id、error_code、covered_until（MISS为[首次到期,covered_until)错过区间，不伪造单窗口数）。成功与批次/游标同事务，失败用savepoint回滚建批副作用后提交失败记录/未来游标；数据库异常整笔回滚，下次读取当前状态。原Batch窗口/身份unique与快照约束继续裁决。

配置命令沿User→资源→Plan锁，后锁cursor；同步cursor与成功审计同事务。调度为内部系统能力、不冒充配置操作者，沿资源→Plan→cursor，重读状态/配置/CAS，复用freeze_batch；批次created_by=NULL并由窗口记录追溯，不增加未授权HTTP系统入口。扫描只选登记到期游标，按next_run_at/ID有界，复用geo_recovery_scan_batch_size/seconds和总开关，在现有beat注册任务，不改部署/env或资源配置。

激活/恢复与实际配置修订使用数据库clock_timestamp，下一窗口严格晚于该时刻，并以最近已处理窗口/MISSED右端点前1us为下限，数据库时钟回拨也不重选已处理窗口；暂停/归档清空游标。若旧游标已到期但未处理，配置命令先记录MISSED(PLAN_CHANGED)区间；无旧配置追赶执行。每次扫描每计划最多建一批；5分钟容许延迟内处理首个到期窗口，其余已到期未执行窗口同事务合并MISSED(LATE_WINDOW)区间，再推进未来游标。晚于5分钟则整段MISSED，不建批。资格失败FAILED，下一窗口用未来时刻，不同窗口可重新裁决；未知DB/程序异常保留游标并用低敏plan ID/异常类型暴露，不伪造已持久化失败。

Cron词法/数值继续用已安装Celery的解析集合，日/月/周同时满足（沿其AND语义）。日历搜索最多一个400年Gregorian周期；DST墙钟fold=0且UTC往返一致，跳过不存在时间，重复墙钟只执行第一次。拒绝无可达日期；无新依赖。

详情/列表新增nullable schedule运行摘要及最新窗口，集合批量读取，不混合配置revision和运行进展；展示下一次时间、最近CREATED/FAILED/MISSED及批次导航，现有状态命令可启停，明确人工采集不外发。新登记计划才恢复CRON动作；历史继续只读。已存在批次人工入口和历史窗口只读重放语义保留。

0067为加法两表/索引/守卫，无旧数据修改。停新扫描可安全回退应用，保留游标/窗口和既有批次；downgrade55000停止，前向修复，不删除历史。定向PG/并发/迁移、前端/页面与公共合同检查；独立只读复核，不全量门禁。

Python ZoneInfo和PostgreSQL可接受Factory等浏览器ICU不支持的IANA名称；新展示仅在Intl构造抛RangeError时明确展示原时刻的UTC，不猜测其他时区或使详情崩溃。
