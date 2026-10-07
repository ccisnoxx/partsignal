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
