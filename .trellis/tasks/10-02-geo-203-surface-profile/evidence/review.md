# 独立只读复核与修正

复核角色 critical_reviewer，隔离上下文；仅审阅 GEO-203 候选合同、ORM、Schema、0046 和相关测试。完整计划、派发、execution、fingerprints 与 digest 位于持久化 audit_id `20261002T150935Z-geo-203-independent-review-fb36451c`。

确认两项 P2：

1. ProfileOut 的测试状态/时间关系未进入公开 Schema。PASSED/FAILED+null、UNTESTED+非空时间会通过原 OpenAPI，但 Pydantic/DB 拒绝。
2. Name 正则首尾 `\S` 未排除 NUL，公开 Schema 可接受 NUL 名称，而 Pydantic 后置校验和 PostgreSQL 拒绝。

主代理已修正：响应 json_schema_extra 增加 allOf/oneOf 条件，同时复用并保留 API 模型引用的 oneOf；名称首、中、尾均显式排除 NUL。同步根 OpenAPI 和 generated types，新增相同反例的公共 Schema/Pydantic 断言，确认 API Out 的半绑定仍拒绝。最终定向55项通过；合同、lint、typecheck均在修正后重跑通过。

其余实查范围未发现确认的阻断问题：两表DDL/ORM、闭合模式/能力/settings、同渠道MATCH FULL FK、成对SET NULL及限制为两个引用列的嵌套触发器豁免、Surface历史锁存、identity/revision守卫、created_by删除计数与RESTRICT。

复核员未重跑PG或全门禁、未验证未来Registry/命令/运行资格/Run快照；复核发现修正后的两项合同由主代理用反例验证，不冒充第二次独立复核。数据库及最终全门禁由主代理运行，见对应命令日志。
