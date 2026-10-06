# 后端只读安全调查（主代理整理已返回的报告）

来源：backend_security，固定 analyst；fresh/none。调查代理未运行测试、写文件、Git、真实平台或生产检查；本文件由主代理保存。运行结果须以主线程 command 日志为准。

## 结论与实际边界

未确认可利用的高风险绕过。当前正式 geo_batch_snapshots.py:38 固定 INTERNAL，registry.py 的 openai-compatible-chat approved=False；profile connection_test 只发送固定 hi，测试成功不授予采集批准。测试 fixture 的 PUBLIC/approved=True 仅属于本地模拟站。当前 GEO 分析为 DETERMINISTIC，输入冻结的 model/prompt 为 null；没有第三方 GEO 分析调用链，不能报告外部模型 system prompt 防泄露已经实测。

认证/CSRF：deps.py:31/97 从 PG 会话裁决、比较绑定 token；管理路由 AdminUser+CsrfProtected，配置/session 应用服务刷新并锁当前用户重验管理员。ENGINEER 投影 configuration=None。AI Key/Header 四条写路径均有 ADMIN+CSRF；既有 test_ai_channel_management.py 只有 ENGINEER GET 反例，主代理补写权限矩阵。

SSRF：pinned_http.py:105/173/353/185 校验完整 DNS 集合、批准 sockaddr、实际 peer、CA/hostname/SNI；任何非公网混合结果失败，URL 凭据/query/fragment/control 拒绝；无 redirect-follow。发送前 geo_runs.py:129 锁内重验 lease/配置/额度、先提交 SENT；单次发送失败不换地址重发，响应长度三种 framing 均限体。

Secret：CredentialCipher AEAD/AAD；API 仅返回配置状态，错误移除原 input；collector 扫描全部允许保留字段里的 key/header 原文与编码，命中拒绝整个结果。审计白名单、GEO 稳定日志字段、Celery scrub 边界保留；Redis 只接 UUID。不能推广为任意人工图片秘密自动检测。

Prompt injection：process_analysis_run 四阶段本地计算，无工具、URL fetch、凭据解密或外部模型；UNTRUSTED_INSTRUCTIONS/NEEDS_REVIEW 与 SQL answer/analysis 不可变守卫。金标和局部 no-network 不能等同实际 Worker 全链攻击反例，主代理已补真实 PG 用例。

Browser：128 KiB/闭合 JSON/domain/origin/期限导入校验，公钥 vault、0600、AAD/digest/符号链接拒绝；专用 capability+当前 ADMIN、profile/compliance/开关/expiry/ref 裁决，访问审计提交后才释放 envelope。撤销墓碑先提交，清理失败 pending purge；0063 禁止引用身份改写和撤销恢复。802管理仍适用，无804 consumer。

## 完整阅读记录

用户要求 PRD；domain-model/state-machines/methodology；technical architecture/data architecture/security；ADR001～006 完整正文；904 prompt/Task Brief；root/backend AGENTS、Trellis workflow、backend/guides索引、AI配置/质量规范。testing-quality 仅读 SEC 矩阵（完整正文由另一调查代理读取）。

合同完整单位：database GEO surface/profile、Batch/Run、Answer/Citation、MANUAL、读取、采集执行、分析/Worker、Browser；OpenAPI Run/Analysis snapshot、surface/profile摘要、rules、Browser六路径及全部session schema。未重读全OpenAPI或全部surface管理路径，主代理补相关单位。

迁移：0048/0050/0052/0054/0055/0063版本入口；完整0048快照/guard、0050 answer guard、0052 profile test、0054 analysis validation/guard/current、0063 session SQL；未审计全部后续迁移链。

源码：auth/CSRF/errors、registry/collector/response/pinnedHTTP/OpenAI client、collection freeze/eligibility/lock/claim/send/result/lifecycle、profile诊断/投影、Browser schema/router/service/storage/vault、cipher/audit/log/Celery scrub、analysis freeze/execution/lifecycle/facts/claims/recommendations。大型AI配置/router/schema只读取相关完整单位；worker只读GEO task单位。

## 测试定位（仅读源码）

- SEC001：test_geo_openai_network.py凭据保留字段/敏感header回显；test_geo_openai_collector.py原文metadata；test_geo_ops_runtime.py canary日志；test_ai_channel_management.py投影；test_geo_surface_management_api.py错误；test_geo_browser_sessions.py import/health/revoke/audit。
- SEC002：test_pinned_http.py；test_geo_openai_network.py DNS/peer/size/TLS；test_geo_profile_tests.py安全拒绝零发送、provider固定错误无重试；test_ai_egress_https.py CA/SNI/Host。
- SEC003：test_geo_openai_collector.py非PUBLIC零授权；test_geo_worker.py INTERNAL不发送/MANUAL不领取；test_geo_claims.py分级全部本地并封锁socket。
- SEC006：test_geo_surface_management_api.py全部管理写/CSRF；test_geo_rules.py；test_geo_profile_tests.py诊断拒绝；test_geo_browser_sessions.py；新增真实凭据写矩阵。
- SEC007：test_geo_recommendations.py injection、test_geo_claims.py instruction-not-authority/no-network；新增实际Analysis Worker。
- SEC008：test_geo_browser_sessions.py service identity/profile/expiry/kill-switch、audit失败不释放、revoke cleanup可恢复、SQL禁止改写、不能启用session catalog。

## 覆盖限制

目标环境、真实批准记录未知；没有生产材料检查；没有外部分析模型或Browser consumer。无确认高风险不等于生产验收通过。独立复核统计不能把本 analyst 调查计为 reviewer。
