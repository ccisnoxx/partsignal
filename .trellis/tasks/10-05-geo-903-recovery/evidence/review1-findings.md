# 独立只读复核1

审查报告由主代理接收；接受的是复核交付，不表示GEO-903验收。

- P1 geo-recovery.py:314 / e2e-database.py:51：PGHOSTADDR继承可绕过回环URL，生命周期与PG CLI可能指向两集群。修复数据库入口拒绝PG*覆盖，定向反例在I/O前失败。
- P1 geo-recovery.py:182/:355：秘密包未绑定Session/Upload来源、恢复只用AI。修复三字段恒时配对+加密proof+恢复实际应用包内秘密；错配key拒绝，恢复在故意不同当前配置下验证原登录token和对象签名。
- P2 geo-recovery.py:325/:424：create完成owner但确认丢失跳过清理。修复create_attempted在I/O前设置，失败仍按精确name+owner调用drop；owner不匹配保留他人库并报告cleanup失败。

复核纯参数解析/AST故障注入，无实际远端连接/写入/宽测。覆盖snapshot、认证/AAD、artifact-before-create、missing对象及Browser条件检查；需要主代理提供修复后真实恢复证据。
