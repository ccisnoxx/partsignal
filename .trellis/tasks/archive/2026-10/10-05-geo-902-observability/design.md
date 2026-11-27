# GEO-902 设计

## 权威与边界

运维观测属于GEO内部运维边界；Run/Analysis/Reservation是事实来源，不改601–604业务指标。通过受保护容器CLI输出只读JSON和Prometheus textfile；不增公共HTTP端点或产品页面，不增常驻服务。

## 状态与采集

只读REPEATABLE READ聚合各模式全部attempt的状态/24小时失败、Collection与Analysis积压及最老稳定ID；无正文/错误摘要/凭据/lease token。Collection pending年龄用created_at，redispatch due独立用coalesce(last_dispatch_attempt_at,created_at)，不把MANUAL待录入当自动系统故障。Analysis等待同时包括尚未创建revision的COLLECTED和未claim的PENDING revision；过期job包括终态Run的重分析。复核积压使用current成功analysis的必要复核与最新有效review，不仅依赖Run.status。

API费用按Reservation.budget_day UTC和全部已发送attempt计账：分币实际金额、已报告/总调用覆盖、UNKNOWN、估计低报及预算利用率；无调用或无匹配币种金额返回null/缺series，不补零/换汇。SQL只读取白名单标量与JSON固定枚举字段，不载入全量snapshot。

## 运行元数据

新增0065_geo_observability与有界operation主键的geo_operation_health，保存最后成功/失败及原子计数/耗时。非业务审计、不写业务表、不影响revision或业务transaction。独立短事务lock_timeout/statement_timeout；记录失败只输出固定低敏故障并使健康/指标不可用可见，不覆盖已完成业务或重发外部请求。

Beat采用已安装Celery 5.6.3 PersistentScheduler子类：tick心跳和成功publish区分；publish错误不打印异常/traceback，保持原有catch/下一次schedule行为。Worker真实heartbeat + 本地PID/心跳文件 + 指定本机Celery ping + PG查询/Registry加载，PID不是唯一证明。每个容器本地心跳防止其他副本掩盖失效；全局运维表仅表示至少一个实例最近成功。恢复/补投递实际执行时间独立暴露，不把tick或ping当业务调度完成。

## 日志与告警

GEO日志使用固定JSON键schema_version/component/event/stage/status/error_code/duration_ms及UUID、数值用量/费用；不包含客户端request_id、provider_request_id、任意异常名称/正文、URL或业务文本。客户端可控ID不得当低敏值自动放行。指标标签仅固定枚举/三位币种，不含Run/Profile UUID和供应商可控模型名；个体定位留受保护JSON/日志。

提交Grafana导入dashboard及Prometheus rules/阈值模拟。系统告警只使用自动积压、租约、扫描失联、业务技术失败码、费用未知/预算异常、storage故障。业务低表现仍由Opportunity及现有Overview/Insights拥有。

## 发布与恢复

先0064→0065加法迁移，再统一API/Worker/Beat；无回填/历史数据修改。暂停metrics采集或停止观测钩子不修改业务历史；保留telemetry表前向修复。不执行903备份恢复、905容量调优、904/906生产检查或R7恢复。


## 独立复核后的收敛

分析等待不继承人工待录入时间；从未成功的operation使用success_count=0显式告警，不能比较NaN时间；Beat producer建连前也有固定回调/无原异常链边界；日志sink I/O失败与连接池释放失败不改变已接受回执，固定stderr用于记录日志sink不可用。已提交业务状态与失败仍由原有服务拥有。
