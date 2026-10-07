# GEO-1009 候选收口检查点

用户已授权按 CI → 整PR接受 → Ready → main → 一次clean main全门禁 → 同SHA RC 推进；预算要求本轮一次远端CI，不额外全量。本轮未进入 main 或接受其他任务。恢复用户GEO-1007/delivery1008既有接受完整保留。

## 固定 CI 与失败

run37572374117，headSha=0b232f2ce268c7e78836a2f2ce811c9eaa45944c。created04:37:46Z，verify完成05:22:32Z，watch 04:38:22Z—05:22:43Z exit1。两个frontend shard、合同/lint/type、3865backend unit、1308front unit、1253PG＋6真实PG16恢复通过；普通PG实际32分38秒、45原告警。两个应用镜像构建成功，但frontend-container缓存头ERE自检退出1，make退出2；其余deploy检查、远端E2E及末尾Compose检查跳过。原始完整/失败日志受保护保存，命令、SHA、时间、退出码及哈希见evidence，不能把局部通过称全CI通过。

## 定向修复与成本

GNU grep不把ERE里的\r解释成CR，BSD实现会接受；真实Linux GNU3.11复现旧表达式对合法CRLF头退出1。脚本用printf产生实际CR，仅修四处Cache-Control匹配，缓存/fallback/Vary/资产/source-map检查与精确清理保留。原生完整容器自检通过；同一真实前端镜像/HTTP响应/资产，原脚本经网络隔离Linux GNU grep退出1、新脚本退出0。该试验只将grep切换为真实Linux进程，整个shell仍在Mac；不是远端CI证据。源码hash绑定工作树验证与随后固定提交，不把dirty14dd记录伪称已在新commit执行。

为避免重复32分钟PG，ci增加明确checks_group选择：默认full全部旧命令、服务、依赖、两路shard及DB14/15隔离不变；delivery仅bootstrap/迁移、build/deploy/E2E/Compose，job名/日志明确partial，不能单独称完整CI。未知值首步退出2。静态结构与实际guard shell通过，尚未在远端执行；追加远端运行必须获得对本轮一次CI预算的调整，不自动触发。

## 独立审查与剩余条件

固定0b整PR源码组合复核APPROVE但以CI成功为条件；六类旧findingRESOLVED。原delivery1007 SOP补正、CRON历史只读与13文件/0066候选示例已fresh独立APPROVE，提交14dd7594452e4080826b15f64683eb3990450704仅文档；不重新接受恢复1008。初次source-equivalence检查误把Git中文路径quote当文件名而exit1，改为NUL实际路径后PASS，未改候选源码。GNU/分组增量固定28e921112aadb9f00da9449f71c4a616babc972d的fresh只读复核已APPROVE；三份受影响文件hash与定向记录匹配，未沿用0b结论替代增量审查。新增报告见evidence/independent-ci-review-28e92111.md。

CI准入未闭合，PR保持Draft，1002–1007接受记录不提前done。main门禁留到真正合并后运行一次。RC仍缺真实镜像发布仓库及已验证previous V2回退引用，已有历史I04镜像删除不能补造；尚未生成tag/archive/images/manifest，不操作生产。现场1010/真实AI-OSS/Browser零材料/正式MANUAL/容量监控备份恢复仍未知。

原始日志目录：/Users/sc/.codex/reviews/partsignal/rc-candidate-20261007；审计bundle与原始只读复核另存。后续候选要求clean main=origin/main固定同SHA，不在门禁/候选冻结期间写tracked记录或伪造metadata。

## 保存检查点

代码28e92111已推送。预算调整问题已向用户提出，未收到答复时不执行第二次远端CI；保持Draft/blocked。定向delivery仅补失败与未执行后序，不重复旧成功单元/PG；未来成功后才组合证据做整PR接受。追加CI未执行、main门禁未执行、RC未冻结。

## 追加一次delivery：真实失败与定向修复

用户明确允许追加一次，dispatch命令/批准原文/UTC时间保存。run37581493190固定c6b310f568798a6f068869870c648189ff7d604d，created06:26:20Z，verify4分21秒，watch06:26:58—06:31:17Z exit1。frontend shard与六项前序按delivery跳过，不算新通过。两个应用镜像构建、canonical frontend容器缓存/fallback/source-map自检（GNU修复）、17恢复边界单元、194Collector合同、fixture金标、17组启动配置、E2E生命周期/数据库生命周期/秘密扫描后处理通过。失败于test-deploy-staging.sh的frontend-only配置解析：checkout没有私有.env.staging；make退出2，余下deploy、E2E及末端Compose未执行。原始完整/失败日志及hash受保护保存，旧失败不改写。

仅修改test-deploy-staging.sh：在测试拥有temp目录复制原始staging及其include的Compose文件，复用已经生成/验证的preview.env作为本次.env.staging；不依赖或覆盖真实checkout私有文件，不改部署Compose、workflow、应用/迁移/依赖，也不加skip或放宽frontend单服务/image/depends_on/links断言，原trap精确清理覆盖新增文件。原生完整自检exit0（1.73秒）。隔离git archive checkout没有任何私有.env，本机Compose5.3.1旧/新均exit0，不能把该结果当红绿。

runner日志绑定ubuntu24/20261004.327，官方固定软件清单为Compose2.38.2。下载该版本Linux ARM64官方客户端并验证release SHA256 4d0f7678dd3338452beba4518e36a8e22b20cad79ba2535c687da554dc3997fb；仅配置探针在network-none本次临时容器中执行，其他shell仍Mac。初次驱动挂载临时路径不能读取输入，exit1保留；改用docker cp传入完全相同文件后，旧真实入口因.env.staging缺失exit1、新入口exit0（总3.73秒），容器按实际ID精确移除。未伪称完整Linux runner，也没有重复全套。脚本hash e5a7a3c50b6cbd2554299180fecc0ef262c0d1623588aa54614f258251389f2d绑定随后提交。相关命令/SHA/时间/退出/日志在evidence。

修复待新固定SHAfresh只读增量复核。此次预算已使用，第三次CI未触发；PR保持Draft，1002–1007没有提前done，1008恢复既有接受未改，main完整门禁留到实际准入成功后的合并。RC与1010现场缺口保持。

固定00b4eca271c635c1fc4b6b0c5fbc08d1dfd680bd的fresh只读增量复审已APPROVE，无确认finding；报告evidence/independent-staging-review-00b4eca2.md，全部tracked前后hash零变化，审计closed/verified。代码已推送；独立批准只覆盖自检增量，失败run不变，main/RC不推进。第三次delivery预算问题已提出，未收到答复时不触发；只保存检查点。

## 本次delivery：production配置自检失败与局部修复

用户再次明确允许这一次delivery CI，run37584298170固定d0f61aaa78522be330207ed335869dafcd50017e，created06:56:12Z，verify4分11秒，watch06:56:22.465622Z—07:00:41.607452Z exit1。staging修复与Production cleanup自检已实际远端通过；随后Production自检在JSON env_file字段处KeyError，make退出2。E2E与末端两项Compose未执行，六项前序/frontend shard按delivery跳过不算新通过。旧单元/PG/本地完整验证输入未变继续复用，三个失败run均保留，未将任何失败写成SUCCESS。命令、SHA、时间、退出码及受控原始日志hash见evidence/third-delivery-ci-*。

使用此前已验证官方Linux Compose2.38.2客户端、network-none本次临时容器复现：默认JSON及no-normalize JSON均展开运行环境而不保留api env_file。只修改Production自检前三个配置探针：生成本次独有公开cookie名的测试拥有env副本，显式解析环境；对默认/async/冻结migration候选的api/migrate/postgres/worker/scheduler比较完整实际environment与该副本，不依赖env_file表示形态。原部署mock的deployment-runtime.env、实际Compose/部署入口/迁移/镜像/依赖/workflow完全不变。镜像/命令/网络/profile断言保留，0600文件及原精确owner清理覆盖；不读取私有环境、不输出environment或秘密值。

原生network-identity配置入口exit0（0.55秒）。Linux2.38.2组件执行旧真实配置入口同样KeyError exit1，修复exit0，错误env_file及额外environment分别AssertionError api exit1（四例总4.21秒）。仅Compose客户端在Linux，shell/断言仍Mac ARM64，不能称完整runner或x86_64验证。两个先行驱动失败（隔离源码缺Node依赖、模板替换误碰环境变量名）日志保留；复用已有node_modules并修正驱动占位符后上述反例成立，不把驱动失败作为产品反例。配置不接触Engine socket；本次临时容器按实际ID移除，未接管固定Production项目。执行发生于d0+dirty修复，脚本hash绑定后续提交，不伪称clean新SHA重跑。

修复待固定新SHAfresh只读增量复核。此前准备的接受脚本/PR SUCCESS说明没有执行或发布，本次结果不满足整PR准入条件；PR仍Draft，1002–1007未done，恢复1008既有接受保留。main完整门禁留到实际合并后一次执行，RC真实镜像仓库及已验证previous V2缺口保留；第四次CI未获本轮授权，不自动运行。

固定bd6abde19a20d2bdcd259254d0a8578d2d36d2bd已获fresh只读增量复审APPROVE，无确认finding，报告evidence/independent-production-review-bd6abde1.md；全部tracked/untracked校验无写入，审计20261007T070747Z-production-ci-env-binding-review-45b5eb7d closed/verified。复核纠正本次runner身份为20260927.320.1（前次20261004.327不沿用），本次固定官方清单同为Compose2.38.2，Linux组件结论不变。完整harness/x86_64及新SHA远端后序仍缺；原三次CI失败、PR Draft、恢复1008接受和main/RC未知不改写。

## 固定135d801e的第四次delivery

用户明确允许当前135d801edc9b1e8dc72dc9892897dd233404a667再运行一次delivery。run37587914372固定该SHA，created07:32:06Z，verify13分5秒；watch07:32:16.309179Z—07:45:38.707207Z exit1。build与完整deploy-scripts实际远端通过（5分16秒），此前GNU/staging/Production配置自检修复已在runner闭合。make e2e首轮32真实栈用例29通过、3失败：geo-loop五个真实截图GET被取消；opportunities两个事实route chunk被取消；plans在最后运行时审计发现response-without-request-identity。后续GEO模式、fixture suite和末端两项Compose未执行，不能称通过；secret scan clean exit0、E2E1/make2，隔离DB/Redis/端口/临时owner精确清理成功。六项前序和frontend shard按delivery跳过，继续复用输入未变的旧证据。命令/SHA/UTC/退出及原始受控日志hash已保存。

本轮只修三个失败spec：plans在首次浏览器导航前挂接审计，并把两次真实前置UI写入纳入精确计数，未知请求身份仍失败；opportunities在实际事实标题和资源加载完成后再Back；geo-loop明确验证五张真实截图complete且naturalWidth>0后才确认，确认后的重读也验证。未增加ERR_ABORTED/资源/未知身份豁免，未改应用、迁移、依赖或CI入口。首次本地定向入口在创建测试资源前拒绝DB14的6个现存键；未删除这些非本轮键。只读确认DB12为空后使用DB12的原有独占preflight/owner清理路径，保存原拒绝记录，不把它当用例失败或代码反例。后续只运行三例，不重跑全单元/PG/部署集合/完整门禁；固定修复SHA需fresh增量审查。

先前预备的SUCCESS接受脚本没有执行。此次预算已使用，第五次CI未授权、不自动触发；PR仍Draft、任务仍blocked，整PR接受/main/clean main完整门禁/RC仍待真实准入闭合。严格恢复1008既有接受未改，历史失败不改写。

定向三例于135d801e+dirty修复执行：07:54:44.782021Z—07:56:22.572976Z exit0，Playwright 3 passed（1.4m），真实PG16/迁移0066/API/Worker/production artifact，秘密扫描clean，DB12一枚本轮Kombu键精确删除、全部端口释放、随机owner DB删除、临时目录清理，本次启动的两个既有dev容器恢复停止。没有执行1253条integration或完整32例。0.35秒真实浏览器边界探针稳定复现晚挂接的同名拒绝，早挂接通过；该探针证明事件边界，不伪称直接重跑旧plans spec失败。四个源码hash把dirty定向证据绑定到随后提交。

固定8fd843471de6d455cafba20da11d81a82b7dd305增量独立复审为CHANGES_REQUESTED：截图数量与every分两次DOM观察，图片错误移除造成空/部分集合假成功；确认后的旧图不能证明异步详情刷新收敛。审查没有发现plans/机会Back修复削弱，原审计/写入计数及四源码两驱动六日志hash核对成立。报告保留，不把首轮三例通过代替该finding关闭。

仅修改geo-loop截图就绪：同一次evaluateAll绑定length=5、complete、naturalWidth；确认前监听真实GET详情，核验回执revision，取该响应的五张截图URL并在当前DOM逐项比较后验证解码完成，不输出签名URL。真实浏览器探针从旧commit和新实际源码AST读取evaluateAll回调，HTTP200损坏图片onerror移除、空、部分、旧URL分别旧true/新false，五张正确解码且当前URL旧新true，全部runtime-errors=0，证明不能以网络审计替代图片结构检查。探针0.59秒exit0；只重跑受影响geo-loop，不重复已通过plans/opportunities或全套。第五次CI仍未触发。

受影响geo-loop真实栈08:06:52.348174Z—08:08:16.358627Z exit0（外层84.0秒），1 passed1.2m/secret clean/本轮DB12键与端口及owner随机DB精确清理。plans/opportunities代码未变且先前三例验证已通过，不重跑。实际执行8fd84347+dirty，由新的source hash记录绑定下一固定SHA；等待fresh只读复审，未重用8fd的CHANGES_REQUESTED为批准。

固定0b6e5aa01e8bd37e70433e0b7c9e3da1d31b6756相对135的三spec累计增量fresh独立只读复审APPROVE，原图片空/部分集合和异步旧图条件均RESOLVED，无新增finding，报告evidence/independent-e2e-review-0b6e5aa0.md。两组源码/四驱动/八日志hash已独立核对，两个审查阶段前后全部tracked/untracked内容一致；审计20261007T075745Z-delivery-e2e-timing-fixed-review-2333f765 closed/verified（两个审查交付均验收：首轮判CHANGES_REQUESTED，补正后判APPROVE；不是两个实现批准），无写入/无残留worker。0b clean上三文件定向ESLint0.66秒exit0；没有扩大本地测试。先前SUCCESS接受脚本显式失效、未执行，第四次CI失败不变，增量批准不能代替整个PR准入或生产验收。

本次收尾仅保存检查点并提交/推送治理记录，任务保留blocked，completedAt为空。下一次delivery需用户明确追加一次预算；在获得授权且新固定SHA CI通过前，不接受其他任务/Ready/合并main/跑clean main全门禁/冻结RC。main仍83ff42e7，恢复1008接受保持byte exact；真正main门禁仍只计划合并后一次执行。

## 第五次固定 delivery 与 GEO API 错误详情断言

用户明确授权在当前0475a776追加一次delivery。run37594203220实际headSha为0475a776056b7689721a42af90766fb94c13c6ed，最终FAILURE，verify耗时14分1秒；命令/开始结束/退出/完整日志hash见evidence/fifth-delivery-ci-*。build与全部部署脚本检查通过；32canonical真实栈用例全部通过（5.2分钟），此前三spec修复取得远端成功证据，secret scan与随机资源精确清理通过。

后续GEO enabled在geo-api-real-stack.spec.ts:104失败：选择历史尝试后，PROVIDER_RATE_LIMITED同时出现在当前详情的错误阶段段落和尝试链span。裸code正则locator既能双匹配触发strict mode，也可能在当前详情尚未切换时仅凭历史span误通过。只把该断言改为运行详情alert内的完整“错误阶段：COLLECTION · code”精确匹配，RATE_LIMIT与UNKNOWN共用；不取first、不删断言、不改应用/迁移/helper/workflow/依赖。其他provider调用次数、费用未知、旧尝试不可变、重试资格及runtime error断言保持。

只运行对应enabled真实栈：0475+dirty一行修复，2026-10-07T08:49:53Z～08:50:50Z，exit0，总57.8秒，1passed(42.5s)/1按模式skipped。真实PG16随机数据库、API/Celery/fake provider、production artifact与429/UNKNOWN重试均执行；secret scan clean，DB12精确Kombu键删除、固定端口释放、随机DB和临时存储删除，两个原开发容器恢复停止。真实Chromium从旧/新spec提取实际locator，历史span单独存在时旧误通过/新拒绝，header与span共存时旧strict拒绝/新唯一通过，RATE_LIMIT/UNKNOWN共四例；该DOM探针不代替应用E2E。定向单文件ESLint和git diff --check通过。源文件、driver及所有log hash见fifth-ci-selected-error-source-proof.json，不伪称clean新SHA重跑。

api-disabled、monitoring-disabled、fixture及末端两项Compose被远端前序失败阻断，尚无本次成功证据。已通过且输入未变的unit/PG/旧本地完整验证与本次32真实栈继续复用；不重复全套。预备接受写入器未执行，其SUCCESS前提不成立，invalidated记录保留；其他task未接受、PR仍Draft、main完整门禁/RC/生产未执行。第六CI未获授权，不自动派发。当前一行修复提交后需新的固定源码独立复审，旧0b6复审只覆盖前三spec，不扩大其范围。

固定b254b58a60ce7696533abd18b0a2bdb30b851d7e fresh独立只读critical_reviewer复核APPROVE，locator问题RESOLVED，无确认P0～P3 finding；完整返回见evidence/independent-geo-api-review-b254b58a.md。审查者重算3份源码/2驱动/3定向日志及full/watch日志hash，区分当前detail告警与尝试链span，确认其他spec字节原样；没有重跑测试。审计bundle20261007T085023Z-delivery-geo-selected-error-fixed-review-518b459f closed/verify通过，1交付/1独立复核，0异常，前后12842个tracked/非忽略untracked及HEAD/status相同。只批准此一行增量；run37594203220仍FAILURE，新的远端成功证据、后序阶段、整PR/main/RC/生产仍未闭合，第六CI未获授权。
