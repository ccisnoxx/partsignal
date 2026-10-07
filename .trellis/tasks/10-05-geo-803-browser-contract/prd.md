# GEO-803 Task Brief：本地模拟 AI 产品和 Browser Adapter 合同套件

## 1. 基本信息
GEO-803 / R7；负责人主代理；分支 `geo/GEO-803`；开始时manifest/Trellis 为 in_progress，本地完成后为 review。2026-10-05用户人工验收完成：manifest 为 done，Trellis 为 completed。依赖 GEO-801、GEO-402 均 done，人工接受记录已核对。无提交、PR、发布或真实平台授权。

## 2. 目标
提供完全本地、可复现的 Browser Adapter 验收环境，在真实 Chromium DOM 上观察流式回答、引用、登录和失败，不用真实外部 AI 作为普通测试。

## 3. 关联需求
WBS GEO-803 完整任务行；PRD §6.3/11.3/14、AC-RUN-02/03、AC-SEC-02；Worker §12/17；测试策略 §5.2；Accepted ADR-002/003/005。只交付测试基础设施，不宣称 R7 试点完成。

## 4. 必读文档
根 AGENTS、Trellis workflow、infra CI/E2E spec；用户指定的 README、delivery 01/02/04/05/manifest、产品愿景/PRD、domain/state、technical 01/05/06/07/08、ADR-002/003/005。现有 GEO-801/402/802 任务记录、当前 OpenAPI 的 Browser Profile/Run错误/Answer/Citation/安全摘要、数据库会话/Run/答案合同与0063迁移、Collector值对象与错误、Browser package/src/tests、Makefile/CI。无子级 AGENTS 适用于 tests 或 browser-collector；backend/frontend 不写。

## 5. 当前行为
独立 Browser service 只做离线内存健康、UUID拒绝及STOP；会话解密消费者边界已有13项单元。无模拟站或Browser合同。GEO-402 API fake和共同结果/错误类型已有；无Browser生产collector、业务发送或证据捕获。

## 6. 目标行为
回环模拟站提供流式增量/长暂停/晚到引用、完成信号、临时聊天、登录/过期、selector初始与运行中变化、挑战页、空答案/超时、敏感账号/支付/调试UI。套件可接收Adapter工厂，验证原文、引用位置、元数据null、稳定错误、发送回调及真实请求计数。故意过早成功、重发、泄漏等反例须被套件拒绝。

## 7. 范围内
- [x] tests/browser-fixture本地站及说明。
- [x] 测试专用参考Adapter、可复用合同断言、正反例。
- [x] 本地网络限制、输出前canary扫描、后端权威类型校验。
- [x] Makefile/CI接线、任务与相关文档证据。

## 8. 范围外
GEO-804真实平台/生产Adapter/Registry/Run发送接线；805生产截图/敏感裁剪/OSS提交；806频率/健康管理；807试点；901保留清理。无后端/前端业务修改、第三方AI、迁移、指标/状态机变化、无关重构或依赖升级。

## 9. 不变量
PG业务权威不变；替身内存仅保存测试计数和哈希，重复提交不去重。测试Adapter不登记生产、不接ORM/Redis。授权回调早于唯一业务POST；发送后不重试。原文/引用不猜测；未知元数据null，空或不确定DOM失败。敏感资料不进入结果、日志或产物；每case独立context并finally关闭。

## 10. 契约变化
OpenAPI/database/generated无变化；无Alembic revision/前滚/回填，head0063。Node测试结果经现有Python CollectedAnswer/CollectorFailure TypeAdapter检查，不建立第二套公共schema。fixture协议是测试私有合同。

## 11. 后端/Collector设计
业务Router/Application Service/Read Model/Worker不变；锁序/revision/lease/SENT与持久化幂等不变。测试server按UUID记录提交次数、UTF8长度和SHA256，不存请求正文/Header/Cookie。Browser网络只允许该fixture精确origin，service worker关闭；CI容器network none提供OS隔离。DOM完成+loading消失+答案及引用稳定联合判定；发送/接收等待限时，外层120秒总超时；selector变化/挑战/登录及时停止，固定安全错误映射复用现有目录。参考实现仅测试用途。

## 12. 前端
无产品路由/query key/URL/页面状态/generated类型变化；fixture为独立虚构应用。

## 13. 测试计划
13 Node单元/checkJs、113后端边界/Collector合同基线已通过。新增本地Playwright合同、模拟站自身计数/实例隔离、故意违规驱动自测、canary输出扫描、Python权威值对象检查。执行git diff --check、make contract-check、make e2e；相关lint/typecheck/unit和新增专用target。环境失败保存精确命令/exit，不伪称通过。

## 14. 验收标准
CI Browser业务访问完全本地；流式暂停不提前完成、晚到引用不遗漏；匿名/已登录context隔离；登录过期/selector变化/challenge/空答案/超时可重复；授权拒绝零POST，发送失败最多一POST，无自动重试；敏感UI确实存在但不在提取结果/统计/错误/日志/产物。

## 15. 验证命令
`make test-geo-browser-contract`、`npm --prefix browser-collector test`、`npm --prefix browser-collector run lint`、`npm --prefix browser-collector run typecheck`、`git diff --check`、`make contract-check`、`make e2e`。实际结果记录implement.md/evidence。

## 16. 数据和上线
不迁移、不回填、不启用功能开关、不接外部服务。测试server绑定随机回环端口；进程/context/server均明确关闭；容器本轮资源精确删除。回滚仅移除本任务测试文件与接线片段，保留全部前序工作。

## 17. 风险与停止条件
流式暂停与晚到卡片要求观察真实DOM变化；不能用固定sleep或fake去重掩盖失败。测试参考Adapter不证明真实平台可用性、合规或生产发送隔离。仅用户五类条件导致blocked；测试/环境失败先诊断记录，不改变安全保证求通过。

## 18. 完成证据
evidence/baseline.md、baseline-sha256.json、initial-status.txt保存基线；实现和精确验证更新implement.md。只在本地完成后进入review，等待人工接受；不标done、不提交/推送/归档。

## 19. 后续任务
GEO-804依赖802/803；805–807继续按manifest推进，本任务不实施。
