# GEO-901 独立只读复核及主代理处理

来源：实际 fresh critical_reviewer `/root/geo901_retention_review` 的完成报告（中文）；无实现代理复用，无模型覆盖。验收通过表示复核任务交付有效，不表示GEO-901人工验收done。

1. P1：file_records.py原302行在引用过滤前LIMIT；老引用文件可以永久占批。已确认真实PG batch=1的反例失败，修正为SQL限批前七项NOT EXISTS，持文件锁后继续重验。regressions-before/after与最终integration-repaired记录覆盖。
2. P1：.env.production.example新增有效键未登记可选，注释期限被误判未知键。复核仅以模板虚构值重现ENV_KEY_SET_MISMATCH；主代理配置回归3项按预期失败。五项登记可选且允许明确白名单，旧runtime、合法期限、非法期限与未知键仍由真实checker/Settings测试。
3. P2：0064墓碑仅行级UPDATE/DELETE守卫，TRUNCATE绕过。真实PG测试已按预期失败，增加BEFORE TRUNCATE FOR EACH STATEMENT守卫；成功保护原墓碑。

复核还检查：全部7项FK；Run→Draft→Files锁顺序；墓碑+删除+七天解绑期限同事务；dry-run无DML/存储；DELETING先提交，存储/完成事务失败后重试；加法迁移、零回填、阻止downgrade。逐字比较0064原PENDING守卫与0051保持相同。

复核执行期间没有观察到维护文件写入：只读派发合同和角色配置、完成报告，以及initial-files→scope-check仅出现主代理明确编辑路径相互印证。报告检查日志37PG及四项已通过门禁；复核时全量集成仍运行，未误列通过。三项修正及新增证据由主代理完成定向验证，没有宣称其再次独立复核。

覆盖缺口：生产OSS删除、目标生产Browser开关/会话、真实Celery周期执行未验证。前两项分别需要生产策略批准/运行环境和904/906验收；本轮只接线并调用真实任务入口在隔离PG及本地字节替身验证。
