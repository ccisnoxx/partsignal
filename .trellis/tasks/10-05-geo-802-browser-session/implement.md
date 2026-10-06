# GEO-802 实现与验收证据

## 交付状态与依赖

2026-10-05，分支 geo/GEO-802。GEO-801 manifest=done、Trellis=completed 与人工接受已核对；802由planned→in_progress→review。仅本任务实现与本地验证完成，等待人工验收，不标done，没有提交、推送、发布或生产迁移。原有数百项未提交GEO工作保留。

Task Brief见prd.md，设计见design.md，完整实现文件清单见files.md（19新增、32修改，共51；不含本Task记录）。初始工作树和文件hash、候选差异、范围核对及验证日志均在evidence。Trellis implement/check.jsonl记录已读取的权威规范；只更新本任务涉及的层。

## 实现结果

ADMIN在现有观测面Browser Profile详情人工选择Playwright storage state、授权期限与明确账号批准，导入独立UUID引用。health返回本地密文存在/完整性及有效期；过期、缺失、不可读分别显式处理，login_probe固定NOT_IMPLEMENTED。撤销先提交不可逆墓碑，再清理材料；删除失败显示cleanup_pending_count与PURGE入口。恢复为重新人工登录导入的新UUID，旧引用永不复活。

API只拥有RSA公钥；AES-256-GCM随机密钥/nonce，RSA-OAEP-SHA256封装。密文v1 AAD绑定reference/profile/UTC六位微秒期限。受保护卷对象0600、目录逐级nofollow、fd锚定、非覆盖发布与fsync，独立于普通OSS。Collector只挂私钥/服务能力文件，每次注入授权回调获取密文并内存解密；finally释放Buffer/state，消费方负责关闭临时context。本任务无真实消费者、网络授权或平台登录调用。

## 修改文件

- Application Service与隔离存储：geo_browser_sessions.py、geo_browser_session_vault.py、geo_browser_storage_state.py。
- HTTP/协议/持久化：新增router/schema/model及0063 SQL/revision；父Profile内部计数、main/models注册、config/audit/User删除引用与Profile删除引用。
- Collector：session.mjs、session.test.mjs。
- 管理UI：browser-session.api/panel/test、surfaces-detail、audit.model、generated schema与真实栈E2E。
- 部署：显式compose.geo-browser-sessions.yaml、两个env example注释、e2e-local.sh临时安全目录与清理。
- 合同/文档：OpenAPI/database、安全/运维、manifest与受影响三个SHA条目。
- 测试：会话/迁移/格式/加密新增测试，既有head库存与内部字段投影预期按0063修正。所有路径与新增/修改区分见files.md。

## OpenAPI 与数据库合同

六个操作：GET /api/v1/geo/collection-profiles/{profile_id}/browser-session；POST同前缀/import、/health、/revoke、/purge；POST /api/internal/geo/browser-sessions/{session_reference}/access。七个闭合DTO、geoBrowserServiceKey方案、精确错误码与响应状态；storage_state为writeOnly SecretStr。Envelope绑定期限专用serializer与JSON Schema保持date-time一致；metadata与密文响应no-store。前端只用generated OpenAPI类型。

geo_browser_sessions仅保存Profile/UUID、密文摘要、授权期限、健康、创建/检查/撤销/清理事实；当前未撤销Profile唯一，User/Profile FK RESTRICT。身份/摘要/期限不可改，DELETE/TRUNCATE拒绝，撤销和清理不可逆。Profile新增session_revision默认0且不公开，每次会话事实变化+1并同步公开revision，非Browser恒0；复用原父revision守卫。

## 迁移、数据与恢复

revision=0063_geo_browser_sessions，down_revision=0062_geo_opportunity_decisions；仅加法DDL，无历史回填/清洗/跨历史删除。空库至head及非空0062至head均在独占本地PG测试库前滚成功；旧行/历史保持，旧Profile内部计数为0，ORM合同匹配。lock_timeout=5s、statement_timeout=120s；失败事务回滚。downgrade明确拒绝销毁撤销历史；安全停止关闭入口并保留墓碑，生产恢复使用备份或前向修复。没有在生产执行。

## 事务、锁、修订、幂等与并发

Application Service拥有事务，Router不持行锁/ORM写入。沿当前User→UUID Channel/Model（如有）→Surface→Profile→UUID session锁序；expected_revision拒绝过期命令。导入先落随机密文，再原子提交旧引用撤销/新引用/Profile失效/成功审计；并发同CAS只有一个成功。导入、撤销、过期或坏卷health使Profile停用并清除测试事实，不授予PASSED。

同当前revision重复撤销无业务变化、不重复成功审计；过期revision仍409。PURGE只作用已撤销对象，缺文件幂等；部分清理失败不能发布purged_at成功。PG与卷无共同事务，导入失败或崩溃可能留下不可访问的加密孤儿，撤销崩溃可能留下已失效待清理材料，不猜测提交状态或虚构补偿成功。Redis没有新任务payload或会话正文。

错误：匿名/停用身份401，非ADMIN/错误服务能力403，跨Profile引用404；revision、模式、导入资格、撤销、过期和关闭开关为精确409；闭合格式与明确批准校验422；卷/密钥/服务身份未配置503。未知异常保留失败，不返回秘密或伪造成功。

## 权限、隐私与审计

管理metadata和命令均ADMIN；写命令使用既有CSRF保护。导入要求APPROVED、AUTHENTICATED、HTTPS网站及approved_account严格true；同origin/domain、128KiB闭合JSON、期限未来且最长30日/不得超过持久Cookie。未知资料明确拒绝。IMPORT投影与执行共用资格所有者。

内部访问仅X-GEO-Browser-Service-Key能力凭据，受限文件注入、constant-time比较，绑定现有活动ADMIN并重验当前账号/改密状态。每次验证开关、活动且合规Surface/Profile、归属、撤销、期限与密文摘要；成功access审计提交后才释放密文。审计只含已登记动作/Profile与session_reference/revision，不保存Cookie、storage state、密文、密钥、卷路径或账号资料。导入及access审计故障均有真实回滚/无返回反例。普通OSS无会话对象；Cookie不进入DB、日志、审计、任务、截图。

## 页面行为与状态

复用/configuration/geo-surfaces及profile_id URL；新增context query key，精确刷新Profile详情/列表。File置于ref、await请求，不进入query/mutation cache、URL、DOM预览或local/session storage。loading/empty/权限/错误/清理待办/完成反馈与重复提交、取消、principal epoch、过期响应均受控；409显式刷新并重新确认，不自动重放秘密。未批准/无HTTPS网站时不提供IMPORT。

## 实际验证与结果

| 命令/检查 | 实际结果与证据 |
|---|---|
| git diff --check | 通过，git-diff-check.log |
| make lint | 通过；最后测试增量额外ruff通过，make-lint.log |
| make typecheck | 通过，backend239文件及frontend/Collector，make-typecheck.log |
| make test-unit | Collector13、backend3725、frontend1285/135文件通过，make-test-unit.log；随后serializer/AAD修正的定向126项通过，expiry-binding-regression.log。未把旧全量结果写作最终新增测试总数。 |
| make test-integration | 首次1082通过/59失败/37 warning，make-test-integration.log；54项fake OSS未启动、5项新增内部字段旧比较预期。修正后按完整59 node ID重跑全部通过，integration-explicit-followup-result.json保存完整参数与exit0。未宣称原make全量运行通过，也未重复十分钟全套。 |
| make contract-check | 通过，contract-check.log；generated与权威schema一致 |
| Docker目标PG会话与迁移 | 20项最终候选定向验证通过，session-final-20-integration.log；此前18项及access审计失败1项独立通过。 |
| TRUNCATE回归TDD | 先用pytest tests/integration/test_geo_browser_sessions.py -k TRUNCATE -q确认DID NOT RAISE；再加同一守卫statement trigger并重新验证，truncate-regression-before.log保留真实失败。 |
| 目标真实栈E2E | PARTSIGNAL_E2E_SPEC=tests/e2e/browser-session-real-stack.spec.ts deploy/scripts/e2e-local.sh；临时独占Redis127.0.0.1:16479/15，1通过3.5s，E2E_SECRET_SCAN=clean，browser-session-e2e.log。trace/video/screenshot关闭，数据库、进程、普通存储、受保护临时目录及临时Redis均清理。 |
| Collector Linux隔离验证 | Docker网络none/只读/pwuser/tmpfs，10会话恢复用例通过，collector-linux.log |
| Compose/shell/文档 | 显式安全overlay config --quiet与sh -n通过；仅三个受影响GEO文档SHA条目已同步，doc-checksums.json 3/3 |

PG命令统一前缀：docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest。最终参数 tests/integration/test_geo_browser_sessions.py tests/integration/test_geo_browser_session_migration.py -q；访问审计反例参数 tests/integration/test_geo_browser_sessions.py::test_access_audit_failure_never_releases_ciphertext -q。59失败用例完整精确参数保存在integration-explicit-followup-result.json，不用不可靠历史--lf缓存推断集合。

基线：既有目标unit78/Collector3通过；原PG调用因APP_ENV=development与测试适配器合同不符失败，明确改test后同范围通过。首次E2E被外部Redis15使用阻断，改隔离临时Redis；随后/var符号链接违反nofollow导致503，修正测试临时路径为pwd -P物理路径，未放宽生产边界。失败重跑过程中--lf意外选到全套，显式SIGINT取消并保留退出2；第一次node ID提取因参数含空格导致collection exit4，修正为完整FAILED行后59项通过。所有首次失败/取消与修正后日志保留，不把未跑/取消写成通过。fake OSS已恢复到本任务启动前停止状态。

## 独立复核与证据

fresh critical_reviewer只读复核后报告：P2外内期限Z/+00:00不一致、P3IMPORT资格投影不完整。两项已修复；P2跨语言修复获得独立复验，P3由主代理与三反例PG测试验证。最终TRUNCATE加固由主代理TDD/PG验证，未冒充独立再次复核。完整覆盖/缺口见evidence/independent-review.md。

Audit Bundle 20261005T084954Z-geo-802-95ef7b23已audit-finalize/audit-verify通过；3实际派发、3验收、1独立复核，配置证据不冒充运行时模型确认。有效SUBAGENT_EXECUTION_DIGEST JSON/Markdown已复制到evidence。候选source与初始工作树证据见scope-audit.json、changed-files.json、geo802-candidate.diff。

## 未运行与已知限制

没有运行真实平台、生产密钥/迁移、完整浏览器矩阵、无关全套E2E或生产灾难恢复；当前改动由本地模拟数据/协议、真实PG、定向Chromium UI与Linux解密覆盖。access↔revoke、用户降权↔access交错经过静态锁序复核，未分别新增动态调度测试；import并发CAS有动态测试。已返回内存无法远程追回，JS字符串不能保证物理抹除；后续consumer需要SEND前授权/context生命周期。

health不验证外部登录或条款；browser-session未批准/零采集能力，默认network none/STOP/开关关闭；部署需要运营者预先准备受限目录、独立RSA密钥与批准ADMIN能力账号。未引用密文的自动保留清理、全灾难恢复、多私钥兼容不在本任务。

进入任务时大量GEO文件已未提交，部分原始字节未备份，不能从HEAD重建精确任务前文本；候选diff明确标注这些完整源，并用初始hash区分原有/新增与验证未触碰其他文件，没有把既有整文件归因于802新增。文档包核心PRD摘要原有不一致已在801记录；本次未修改该无关内容或宣称全包摘要通过。

## 后续任务

803本地模拟产品/adapter合同套件；804首个批准真实界面adapter（须802+803完成后独立进入）；805截图/806治理/807试点及901保留清理、903灾难恢复。均未在802实施。

## 人工验收完成 — 2026-10-05

本会话用户明确表示：“我已经人工审查并接受 GEO-802 的实现与测试证据。”据此记录manifest=done、Trellis=completed，完成日期为2026-10-05。既有review阶段实现、测试结果、首次失败与覆盖限制保留为验收前历史，不改写已有验证结论，不重复运行功能测试。

本次只收尾GEO-802，不修改其他任务状态、不实施后续任务，不提交、推送或归档。SHA256SUMS只同步manifest条目。验收前状态保存于evidence/acceptance-before.json；收尾git diff --check精确命令与结果保存于evidence/acceptance-diff-check.json/log。
