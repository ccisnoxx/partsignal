# PSR-004 引用证据

references-before.tsv 记录编码前全仓 rg --hidden 的每条匹配位置、符号和分类，共1756处、468个文件。历史 Alembic SQL 中 validate_header 是冻结的数据库校验函数，属于历史记录，保留原文。文档/配置分类包括权威说明与 Nginx/Browser seccomp 部署配置；其中 Socket/SSL 与本次 AI 网络栈无关。

references-after.tsv 由隐藏及 ignored 源搜索产生，同时包括旧模块路径和 parse_generated_draft。排除 .git、依赖/工具缓存以及引用清单自身，避免递归引用报告。历史快照、任务记录、GEO交付/决策记录保留原文；维护README的旧文件名只说明PSR-001的历史范围。当前源码/测试/脚本不存在旧栈匹配。后续任务记录会增加历史匹配数，不能把该数当作运行时残留。

## 通用标准库与测试设施保留

- backend/app/geo_fake_server.py：socket 类型和真实断连，用于显式本机 fake provider，不是生产AI传输。
- backend/app/geo_ops_health.py：socket.gethostname() 形成当前Celery节点名，不创建网络连接。
- backend/app/geo_citation_urls.py：ipaddress 规范化引用URL的IP主机名，不做AI出站DNS审批。
- backend/tests/geo_reference_collector.py：http.client 仅为合同套件自测驱动，限定已启动loopback server对象，不接受业务URL/配置，不依赖已删除旧栈；其独立发送状态反例保护套件自身，不能描述为当前SDK的字节阶段保证。
- tests/geo_network_guard.py、geo_recovery_support.py、test_geo_claims.py、test_geo_ops_health.py、test_geo_production_boundary.py：测试网络隔离、资源释放与运维禁止外发断言，保留。
- deploy/scripts 的 socket/ipaddress：端口分配/探测、部署URL配置检查、测试禁止外发和Docker Unix socket；Nginx ssl、Browser seccomp/collector测试均范围外。

## 删除/保留测试对照

整文件删除 unit/test_pinned_http.py 和 integration/test_ai_egress_https.py，仅覆盖旧DNS/Socket/TLS/HTTP内部机制。StubTransport、FakeSocket、PeerOverrideSocket、临时CA、LoopbackTransport和TestDeadlineTransport删除。

unit/test_ai_boundaries.py 的凭据加密、锁定Header名称、保留Header/注入、模型参数、审计及5个严格草稿用例保留；草稿用例改在实际生成服务+SDK边界执行。旧URL DNS分类、旧协议路径/hi/redirect/timeout重复测试删除，相同行为已有SDK与生成测试覆盖。

Profile的成功不创建Run/不启用、错误脱敏/零重试、权限/CSRF/功能/搜索/合规门禁、依赖失效、输出参数哈希及4种在途revision交错保留；仅删除3个旧TLS/DNS/peer内部反例与2个传输期超限诊断用例。GEO Collector的接收后大小检查保留在network/collector金标中。

fake provider自测整体保留，使用通用httpx发送：真实timeout/disconnect/redirect/状态码、两种超限载荷实际字节、计数/并发/实例隔离、闭合控制、敏感canary和loopback guard。Collector共同套件、严格解析、UNKNOWN、预算与状态机测试保持；不可信回答安全测试改拦截三个真实SDK入口，保留OS网络/进程/凭据禁止边界。
