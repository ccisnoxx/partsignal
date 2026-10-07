# GEO-804 Preflight、基线与阻断证据

## 当前状态：deferred / post-core

2026-10-05 用户明确将 MANUAL 回答级观测作为核心正式采集方式，真实 Browser 自动化延期。依据[ADR-006](../../../docs/geo-monitoring/05-decisions/ADR-006-defer-browser-collection-and-adopt-manual-first-core.md)，manifest/Trellis blocked→deferred，release=post-core，未实施或标记完成。原平台批准/staging输入缺失及全部基线日志保留为历史；恢复条件以当前 manifest 和 ADR-006 为准，不因依赖 done 自动执行。范围调整与验证见[治理任务](../10-05-geo-browser-scope-adjustment/implement.md)。

## 原始阻断结果（历史）

2026-10-05，GEO-804 / R7，分支 geo/GEO-804。依赖 GEO-802、GEO-803 均为 done，人工接受记录已核对；GEO-804 从 planned 进入 blocked，Trellis 从 planning 进入 blocked。未开始 Adapter 实施，不虚构 in_progress、review 或 done。

阻断依据是用户明确允许的“完成本任务必需的外部输入或人工授权缺失”。未找到可确定唯一 BROWSER 平台及其批准范围的输入，也未获得受控 staging smoke 授权与入口。此结论限于本会话及已检查的仓库/配置，不能推断其他外部审批系统不存在批准记录。

用户回答可以检查 .env 配置，已按授权检查 .env/.env.staging/.env.production、相关示例和 AI JSON。派生事实：三个实际 runtime 文件无 GEO Browser 平台/合规/账号/频率配置；模板四项 GEO 开关默认 false；生产 AI JSON 配置 HTTPS DeepSeek API 端点。未打印或保存密码、API Key、Cookie、Header、密钥、数据库连接值或配置正文。API 配置不等于 DeepSeek 产品界面的自动化批准，也不自动授权账号、环境、速率或数据用途。

平台批准需求来自任务显式约束及 Accepted ADR-005 的 GEO-002 修订：未批准的平台仍不得启动 Browser 自动采集，批准范围须覆盖账号、用途、环境、速率和保留规则。staging smoke 授权来自任务显式最低验收要求。本次使用 trellis-before-dev 和 structured-response；没有技能额外创建批准门禁。

## 编码前十二项 Preflight

1. 依赖：GEO-802/GEO-803 均 done；GEO-804 原 planned，依赖已满足，但真实平台门禁未就绪。
2. 当前行为：生产 Browser 只做离线健康/STOP/UUID拒绝；browser-session 注册零能力、未批准；API Worker 忽略 BROWSER。
3. 目标行为：一个批准平台的 temporary chat、submit、stable wait、answer/citation extraction、version metadata；DOM不确定/未稳定/空答案失败，批准频率限制生效。
4. 差异：GEO-803 Adapter只在tests；生产真实DOM、Browser发送授权/运行接线和Browser配额尚缺；会话访问仅授权密文读取。
5. 范围：仅804；805截图/裁剪/对象存储、806完整管理/治理UI、807完整试点均不实现。
6. 文件计划：批准齐备后定位browser-collector/src/adapters、对应合同和必要Registry/Application Service；当前只写任务证据、manifest与其摘要。
7. 合同/迁移：当前OpenAPI/database/generated/Alembic无改动；Browser settings缺配额，批准参数确定后才决定加法扩展；无新revision/回填/前滚。
8. 事务/锁/revision/幂等/并发：既有Application Service、lease/token、SENT与追加attempt合同保持；未修改锁序，不使用Adapter进程内状态替代PG配额。
9. 前端：无路由、query key、URL状态、页面或类型变更。
10. 安全/隐私/外部调用：不将API端点当Browser批准，不接真实AI、不改STOP/network none/开关、不接触或保存会话明文。
11. 测试：现有本地Browser合同27项/权威结果18份、Node13项、backend233项和contract-check通过；最终diff与任务归属核验见evidence。
12. 风险/停止：命中必需外部输入/人工授权缺失，blocked；没有发现其他四类停止条件成立的证据。

## 实际验证与证据

| 精确命令 | 实际结果 | 证据 |
|---|---|---|
| make test-geo-browser-contract | exit 0；27通过，0失败/跳过；18份结果经后端类型校验；secret_scan=0，外网阻断 | evidence/baseline-browser-contract.json/.log |
| npm --prefix browser-collector test | exit 0；13通过，0失败/跳过 | evidence/baseline-node.json/.log |
| UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_browser_boundary.py backend/tests/unit/test_geo_collector_contract.py backend/tests/unit/test_geo_collector_suite.py backend/tests/unit/test_geo_collector_registry.py backend/tests/unit/test_geo_browser_storage_state.py backend/tests/unit/test_geo_browser_session_vault.py -q | exit 0；233通过；项目quiet配置未输出汇总，按pytest进度行233个通过标记计数 | evidence/baseline-backend.json/.log |
| make contract-check | exit 0；FastAPI完整runtime contract及generated OpenAPI类型一致 | evidence/contract-check.json/.log |
| git diff --check | exit 0；任务状态/文档修改后运行；新增任务文件另作空白与归属检查 | evidence/final-checks.json、diff-check.log |
| UV_CACHE_DIR=.cache/uv uv run --project backend alembic -c backend/alembic.ini heads | exit 0；0063_geo_browser_sessions (head)；仅检查迁移源码图，不连接业务库或前滚 | evidence/alembic-heads.json/.log |

这些成功只证明既有基线，不能证明 GEO-804 实现、真实平台 DOM、Browser 频率限制或 staging 可用。没有新增或修改测试来伪造交付。

## 未运行与未验证

- 受控 staging smoke：缺已批准BROWSER平台/账号/用途/环境/地区/配额/保留规则及人工smoke授权、入口，不能运行。没有真实平台调用。
- GEO-804 Adapter合同、Browser频率/并发/发送授权集成与独立只读评审：没有候选实现，尚不能验证这些新合同；现有本地参考Adapter不是真实Adapter。
- 新Alembic前滚/live current、PG integration、真实业务E2E：本轮无DDL或业务/页面/Worker改动，不操作live数据库。
- 全量make lint/typecheck/test-unit/verify、完整E2E、Linux合同容器与浏览器矩阵：任务在实施前被业务门禁阻断，本轮仅新建任务文档及状态，未重复无关完整回归。不宣称这些命令已运行。

## 本任务修改与边界

修改仅包含 docs/geo-monitoring/04-delivery/task-manifest.yaml 的 GEO-804 状态/阻断说明/Trellis路径及验证记录、docs/geo-monitoring/SHA256SUMS 的manifest对应条目，以及本任务目录。起始39份相关源码/合同/迁移/部署入口摘要保存在evidence/baseline-sha256.json；最终比较仅允许manifest/SHA变化，其他维护源码保持原样。task-only diff和所有非804条目相等断言保存于evidence。

没有OpenAPI或database变化，没有新Alembic revision、数据迁移、回填或前滚结果。0063_geo_browser_sessions是当前源码head，不是本任务新迁移。事务、权限、CSRF、SSRF、TLS、不可变、审计、Redis参数与错误映射均不变；无前端业务变化。未委派，没有候选高风险实现，不将自查称为独立复核。

没有提交、推送、PR、生产发布、外部写入或后续任务实施。Task记录未归档；未执行task.py start，未借用其他会话指针。

## 恢复所需输入

补齐唯一平台/真实界面域名与可定位合规批准，专用账号非敏感标识与负责人、用途、允许环境/地区、频率/并发上限、保留/停止规则；补齐受控staging smoke人工授权和入口。秘密仍只通过既有受保护部署/会话导入通道传递，不放任务或聊天。

收到输入后重验本Task和依赖，完成平台特定DOM与发送/配额设计；依据实际合同选取需要的源文件/迁移，再进入in_progress实施。实现及本地验证完成只进入review，真实smoke结果如实记录。GEO-805/806/807仍按manifest后续执行，本轮不实现。
