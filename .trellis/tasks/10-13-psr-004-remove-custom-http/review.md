# PSR-004 独立只读复核

Fresh critical_reviewer 未确认阻断问题。审查限定于初始工作区快照与候选的精确增量，未将前序 SDK/部署修改当作本轮。主代理已核实修复后的89项SDK/E2E与4项PG竞争定向回归通过，接受该复核报告；报告验收不代表用户已接受PSR-004。

## 实际覆盖

- validate_header、token正则和保留名集合与删除前实现AST一致；配置、CLI、Collector调用者已迁移，当前app/tests/deploy无旧客户端/传输/解析函数漏引用。
- Profile原业务owner仍预留测试、停用、事务外调用，并在返回后复核身份、资格、attempt与依赖revision；安全摘要和审计归属保持。SDK不拥有事务或启用动作，无隐藏fallback。
- E2E配置与Profile实际诊断owner都接SDK，精确本机URL与Profile真实attempt/模型独立UUID保留。PG交错wrapper原样转发configuration。
- 删除测试只服务旧DNS/peer/TLS/HTTP字节实现；混合文件保留凭据、快照Header、严格草稿、权限/revision、fake真实故障/字节/计数/隔离。禁止分析器外发测试改拦截实际SDK入口。
- 未改OpenAPI、DB/Alembic、依赖或历史实施记录；已授权移除旧固定IP/peer/底层限体保证，Collector接收后大小检查和UNKNOWN不重放保持。

## 独立执行与限制

审查者用openai3.29.0、虚构Key与httpx2.MockTransport执行无落盘检查：14个异常SDK响应结构/usage场景每个只发送一次；8个Profile owner场景覆盖Header零发送、非法UTF8、空/NUL正文、401、timeout安全FAILED、正常PASSED均保持停用，以及非法UTF8同时revision漂移优先REVISION_CONFLICT、零提交/成功审计。Profile组使用内存替身替代锁/持久化，不替代PG。

未重跑PG、整组pytest、真实Provider、完整E2E或全量门禁。原始日志读取主要为收集证据；主代理测试/Ruff/mypy不能记为审查者独立运行。

## 审计

Audit ID: 20261013T124250Z-psr-004-remove-custom-http-79657bf5。WorkPlan/guard/summary/digest、audit-finalize与audit-verify通过，Bundle closed、无异常。复核期间已记录的受审源码/测试哈希未变化，未观察到范围外新文件；任务证据由主代理更新，哈希不代替行为验证。模型/推理档位来自Agent TOML配置，不作为运行时遥测。
