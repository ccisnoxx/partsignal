# GEO-904 / R8 安全与合规专项复核

复核日期：2026-10-05。依赖 GEO-903 在 manifest 为 done，Trellis completed，已核对用户人工接受记录。按 Accepted ADR-006 核心 R6→R8；GEO-804～807 deferred，不作为本次前置。

**本轮已完成仓库实现复核和本地安全测试；生产验收尚未通过。** 未收到本次目标环境名称、授权只读入口或脱敏现场报告、实际启用平台及批准清单；这些必需外部输入缺失，最终状态按任务停止条件记录 blocked。不能用默认 false、未批准 registry 或新建恢复演练来源代替目标现场证据，也不能自行批准例外。

## 1. 实际实现与目标设计

当前原始回答、批准事实、机器分析和人工复核分离，PG 是权威。MANUAL/API 既有公式、历史、权限及安全边界未修改；本任务只新增两项真实 PG 安全反例及报告。

正式 `geo_batch_snapshots.py` 冻结 INTERNAL，`openai-compatible-chat` registry 的 `approved=False`；连接诊断资格只发送固定 hi，不创建业务 Run或批准采集。测试 fixture 的 PUBLIC/approved=True 使用本地模拟 provider。代码门禁不是实际平台批准材料，当前目标是否启用API仍未知。

当前 GEO 分析固定 DETERMINISTIC，无第三方分析模型/system prompt/工具调用链。SEC003/007 的本轮结论限于本地分析及当前采集拒绝外发；目标文档中的外部分析服务验收在实际引入后另行进行，不在904新增该能力。Browser注册没有采集/诊断能力，普通Worker只领取API；802管理安全合同仍适用，无804 consumer。

## 2. TEST-GEO-SEC 全项映射

下列“本地通过”指本轮执行的单元/组件/真实PG证据；不表示生产运行事实已确认。详细命令、失败与修正记录见[实施记录](../../../.trellis/tasks/10-05-geo-904-security/implement.md)，调查报告见[后端](../../../.trellis/tasks/10-05-geo-904-security/evidence/backend-security-analysis.md)和[前端/部署](../../../.trellis/tasks/10-05-geo-904-security/evidence/frontend-deployment-security-analysis.md)。

| 检查 | 实现与直接测试入口 | 本轮结论与限制 |
|---|---|---|
| SEC001 secret | collector扫描所有允许保留字段的Key/Header原文及编码，命中拒绝结果；API投影、错误、审计白名单及日志/Celery scrub；`test_geo_openai_network.py`、`test_geo_ops_runtime.py`、AI渠道/session PG测试、前端`browser-session.test.tsx` | 本地边界通过；不声称检测所有未知秘密。MANUAL截图需按SOP先裁剪/脱敏，HEAD/MIME/hash不检测图像内容；未检查生产截图/cache/session材料。 |
| SEC002 SSRF | `pinned_http.py`完整DNS集合、sockaddr pin/peer、TLS CA/hostname/SNI、无redirect、单次发送及限体；`test_pinned_http.py`、`test_geo_openai_network.py`、PG `test_geo_profile_tests.py`/`test_ai_egress_https.py` | 本地反例及真实本地TLS链通过；没有访问真实平台，未验证生产DNS/TLS/代理运行配置。 |
| SEC003 分级外发 | 非PUBLIC在发送授权回调前拒绝；分级facts只做本地计算；`test_geo_openai_collector.py`、`test_geo_worker.py`、`test_geo_claims.py` | 当前实际边界通过；外部分析模型未实现，不报告其集成已验收。 |
| SEC004 XSS/链接 | React文本、Markdown sanitize/skipHtml；citation仅http(s)/无userinfo/control、只保留不fetch；Run Detail/Markdown/insight组件与`test_geo_answer_contract.py` | 本地组件/单元通过；本轮未重新执行真实栈E2E或目标CSP/TLS检查。 |
| SEC005 CSV | 所有文本列处理Unicode空白/control后的=+-@，csv.writer转义，固定文件名/no-store和字段白名单；unit/integration `test_geo_reports.py` | 本地通过，隐藏正文/URL query不导出；不改变指标公式。 |
| SEC006 权限/CSRF | ADMIN/ENGINEER PG会话、应用服务当前用户重验；surface/profile/rules/session现有反例；新增`test_geo_security_review.py::test_engineer_and_invalid_csrf_cannot_write_channel_secrets` | 四条Key/Header写路径各拒绝ENGINEER与错误CSRF，配置/密文/revision/成功审计哈希不变；本地通过。 |
| SEC007 prompt injection | 不可信指令不是事实/控制来源，原文及hash冻结；新增`test_geo_security_review.py::test_injected_answer_stays_data_without_tools_secrets_or_review_bypass` | 实际Analysis Worker不调用凭据解密、transport/socket或进程；DETERMINISTIC、UNTRUSTED_INSTRUCTIONS、UNJUDGEABLE、NEEDS_REVIEW且无人工review。虚构canary未进入结果/日志；本地通过。检测规则不是通用注入防火墙。 |
| SEC008 Browser引用/撤销 | service专用key+当前ADMIN、开关/合规/profile/ref/expiry/digest；审计提交后释放密文；撤销墓碑先提交、清理失败可见；`test_geo_browser_sessions.py` | 802本地合同通过；804 consumer未实现。目标生产引用/会话/材料检查缺失，不能给核心Browser N/A。 |

## 3. 权限、并发与不可变边界

没有改Router/Application Service事务归属、锁序、revision、状态机、幂等、lease或错误映射。新增测试使用真实PG临时库、真实角色会话及当前迁移；不弱化CSRF、不伪造生产身份、不读实际密钥、不调用第三方AI。

现有出站在首字节前锁内重验资格/lease/额度并提交SENT，发送后未知结果不自动重发；Browser access先完成审计再释放envelope，撤销先落不可逆墓碑；原始回答/事实/分析/复核守卫及历史保持。新增攻击用例检查拒绝不写状态，以及不可信回答不能绕过人工复核。

## 4. 目标环境与批准检查

| 必需证据 | 本轮实际取得 | 状态 |
|---|---|---|
| 同一环境身份、部署revision和检查时间 | 未提供 | NOT_VERIFIED |
| API、Worker/Beat当前运行的Browser开关false | 未提供 | NOT_VERIFIED |
| 实际Browser服务、geo-browser profile未启用；DB Browser profile未启用 | 本地Docker未观察Browser容器，仅本地开发范围 | 目标NOT_VERIFIED |
| capability、私钥、公钥、密文/session根路径与卷/挂载未启用且无材料 | 未检查目标路径/卷/主机 | NOT_VERIFIED |
| PG无生产Browser session及历史/配置session引用 | 901开发与903新建隔离来源历史证据不是本轮生产 | NOT_VERIFIED |
| 实际API平台inventory及授权/条款/数据范围/地域/账号/期限批准 | 未提供，不将registry或连接测试当批准 | NOT_VERIFIED |
| Browser清理/恢复的条件性N/A | 未部署且无材料的目标负证据尚不齐全 | NOT_DETERMINED |

[本轮本地Docker记录](../../../.trellis/tasks/10-05-geo-904-security/evidence/local-container-inventory.json)明确标注 LOCAL_DOCKER_ENGINE_ONLY_NOT_TARGET_PRODUCTION；[目标检查状态](../../../.trellis/tasks/10-05-geo-904-security/evidence/target-environment-status.json)以null保留未知，不猜false/0。

后续只读补证应输出同环境的布尔/计数、revision和时间，不保存env原文、Cookie、storageState、Key/Header值、账号资料或原始Docker inspect。若发现Browser材料，必须保护并按已验收802/901/903范围处理，不能借deferred忽略或删除。若实际API未启用，也须附运行/配置依据才可对实际平台检查标N/A。

## 5. 风险、例外与恢复条件

已检查实现中未确认可利用的高风险绕过；这不等于缺少目标证据的风险已被接受。本轮未创建或接受例外，因而没有可用于放行的责任人/到期日记录。任何未来高风险例外必须明确风险、批准人、责任人、范围与到期日，否则继续阻断。

阻断原因仅为完成904必需的外部输入缺失，不是把R7 deferred当依赖，也没有业务冲突或历史迁移需求。收到目标只读入口/脱敏现场报告与适用平台批准inventory后，继续904剩余检查并更新证据；全部条件满足后才可进入review，done仍需人工接受。GEO-905/906及804～807本轮均未实施。

## 6. 契约与交付

OpenAPI、generated类型、数据库合同及Alembic均无变化；当前head `0065_geo_observability`。本轮临时PG测试沿当前链前滚，未执行生产迁移或数据回填。无前端路由/query key/URL/页面行为、运行配置或默认开关变化。完整命令结果、环境故障分类、任务增量diff和清理证据保存在Trellis记录，不能把未运行检查写为通过。
