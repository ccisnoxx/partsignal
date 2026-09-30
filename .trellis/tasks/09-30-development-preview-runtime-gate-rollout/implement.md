# 执行记录

## 本地连续性与保护

托管worktree从精确2f171300创建，初始HEAD精确/clean，origin/main及ls-remote同提交。9a2d29b6..2f171300仅3项Trellis收口记录变化；复用代码完整门禁与最终NO BLOCKER，不重跑make verify。原检出区只有用户AGENTS.md修改，diff SHA8475b78dd8ba60f75d7992f8c5a2fda96ce1b1a2d1afc334fda7a09ac60daf3e；未暂存/stash/restore/checkout。旧frontend-redevelopment worktree未操作。

release归档来自git archive 2f171300并重放SHA精确；1941504 bytes、SHA c83c6ece8f11e1c4fa4d340dc50fd7dde6b828948598febd255f75577ef8e0d2。758项源由commit固定，Trellis和浏览器目录export-ignore；私有env/AppleDouble/private key条目0，AGENTS.md是commit字节，用户改动未进入archive。高信号扫描archive仅1既有Bearer测试fixture，tracked扫描2既有不变fixture、候选0命中。未知secret格式不是穷尽检测。

新worktree额外Nginx源码检查入口因缺typescript依赖失败（环境限制），该未变源码检查在复用完整门禁已通过；未安装依赖或重跑全门禁。远端nginx -t、checksum与六项精确响应头为本次部署证据。

## 只读前检

现有preview-20260929-082104-4e85aaf9、7个项目容器全部running/restart0/OOMfalse、oneoff0，3网络物理/logical/project/internal精确，9非项目容器与本次基线稳定。公网root/asset/live/ready=200且六头精确；Nginx有效/pending无。env root:root/regular/non-symlink/0600/1583bytes/原SHA。三个原数据目录device/inode/mode见remote-before。AI channel rev1/model rev4、PASSED+enabled，credential配置存在且更新时间不变、Header记录0；schema0043、原账号/旧Job/Version lineage保留，active Jobs0。

## 独立写入前复核

fresh critical_reviewer审查期间提出并解除3项：二次build、current可执行回退、ambient Compose project。最终NO BLOCKER绑定执行器91934dfa49c4e2e0273fa0095dcdddf95cacda924b15b31e35409db0752f51fe及design4609383fbb1dd0444917b0ae07195391b2cc207010fabe9c86b48f2f0721ca78。无远端写入前再次基线核对全项一致。复核局限见evidence/prewrite-review.md；本机恢复材料不代表异地灾备或隔离恢复演练。

## 受控备份与发布准备

backup stage exit0。原env与DB备份配对保存在/root/partsignal/shared/runtime-gate-rollout-backups/preview-20260930-111500-2f171300，目录0700、文件0600。原env 1583bytes/SHA05adbfab384d9417d60e7e28d516a17ea4f84c5a9e778ebcb8e02c5db104ee85；postgres.dump 174866bytes/SHA97f71e40eeb9503510eff5ede5b32c988a05846aa5ca0469a064dc6258a73e39。pg_dump -Fc一致性备份，pg_restore --list exit0，仅目录解析；没有下载/解密/打印密文。没有删除旧备份。

源archive排他上传/root/partsignal/releases/preview-20260930-111500-2f171300.tar.gz，远端1941504bytes/SHA匹配，upload exit0。后续实际阶段记录由evidence/*-result.json给出。

## 升级、模式与数据连续性

prepare/candidate/switch/current阶段均exit0。候选backend ID072aac34239b9f76782b8f6b1a9badf97e6c7ab5792c6a70464f0138eb890c66、frontend ID5b65fa7f7c2662f675ef577b5b50a32f6e398a2f6371d1a121fea11ebbd0390f；RepoDigest为对应repository@sha256，platform linux/amd64，实际images见candidate/switch-result。只build一次，消费命令--no-build --pull never、固定project。没有调用fast wrapper，没有migration/initialize-accounts/clean-init或数据删除。

env从原1583bytes/SHA05adbfab…ee85变为1587bytes/SHA3f43478292b82002c4bc6bae44adb580f939f6c74219346d0cb5364fc41141cf；后验原env替换单字段后与安装env逐字节一致。root:root/0600/regular/non-symlink。API/Worker/Scheduler新容器均主进程启动env mode=openai-compatible，38个键与共享配置逐键一致；同源码hash及新image identity。探针另在exec解释器导入真实Settings；它不是主进程内存遥测，PID1启动env、进程新建时间、不可变Settings源码及无热更新合同共同证明当前主进程模式。

post-deploy/pre-current/final-runtime全部验证通过：7项目容器running/restart0/OOMfalse，oneoff0；3网络和原数据目录device/inode身份不变；9其他容器身份/状态不变；公网root/asset/live/ready精确200/六安全头，回环live/ready/frontend200；Nginx完整配置/站点SHA未变化且nginx -t0，pending0。current只在候选健康和真实生成通过后原子切到releases/preview-20260930-111500-2f171300，最终再次通过。

## 唯一真实生成

正常ADMIN UI创建CT-43997411（43997411-afe2-4a45-88f5-9d20605015a6），记录标签DEV-PREVIEW-RUNTIME-GATE-20260930。现有ContentTask没有可编辑名称字段，使用正常生成的CT标识绑定记录标签，不改产品代码。复用既有Product/批准PUBLIC Fact/Platform/Prompt。公开generation-options200返回原模型、精确deepseek-flash、Prompt rev0。可见UI明确一次confirm；实际采样PENDING/attempt0，随后SUCCEEDED/attempt1/error=null。没有新模型测试、重试、人工作品保存、自然化、审核、批准、发布或删除。

Job abc4e3cd-efc2-40fb-a87d-330a378bfecb，ContentVersion40445d14-fa04-4bb9-80b0-f9cef49257b0。开始2026-09-30T12:58:34.721618Z，完成12:58:37.944496Z，provider duration3147ms。新的AI DRAFT version1/revision0、created_at=updated_at；current pointer/source_job_id/Prompt0/PUBLIC Fact/channel/model/exact provider ID全匹配，冻结消息与权威Prompt/Fact比较true。旧Job/Version/audit逐字段未变。content_reviews0/publication_works0/active Jobs0。

Usage total_jobs和succeeded_jobs从1→2，failed0；prompt tokens257→514、completion339→1015、total596→1529，单次增量257/676/933。仅一个新增Job/attempt1；Worker唯一allowlist完成记录与同源码SHA，正式UUID入口无generator injection，OpenAICompatibleClient.complete固定单次无重试，因此调用精确1，无deterministic fallback。该计数证据是应用状态+实际Usage+执行路径，不冒充供应商独立计费遥测。PENDING实际采样，RUNNING瞬态未逐点采样，started_at/attempt_count和既有Worker状态机提供转换证据。完整快照/原始Provider request或response未导出。

## 资源与secret后验

680个提取源码文件与原archive逐文件SHA精确；共享env仅一个受控symlink，AppleDouble0；六项实际env secret与源码对比命中0，启发式扫描只保留1原Bearer测试fixture。post-secret-scan.json exit0。没有读取credential/Header密文或值，没有secret进入argv、证据、Git或浏览器状态。截图只含PUBLIC合成样本草稿和成功状态。旧release/images/archive及更早历史证据、env/DB配对备份仍在；无清理。

原检出区AGENTS diff SHA再次完全相同；保持原main=2f171300，不通过reset/stash/checkout更新原检出区。最终push后它将落后origin，属于明确保护策略。

本机直接公网根页面和asset SHA与Hostdzire容器回环字节精确一致（frontend-owner.json），验证当前Frontend流量owner。最终独立复核与执行摘要见下段；Git收口按实际成功回执记录。


## 最终独立复核与执行审计

fresh critical_reviewer于2026-09-30T13:13:49Z另行执行Hostdzire只读核对，最终NO BLOCKER。实际release/archive/image/env/backup/current、数据库与AI配置连续性、新旧lineage/Usage、三个消费者模式、回退材料、secret边界、公网与资源状态均通过；未运行恢复演练、故障注入或容量测试，完整范围和局限见evidence/final-review.md。没有增加供应商调用或远端业务写入。

审计ID：20260930T123258Z-development-preview-runtime-gate-rollout-13c16622。两项计划、两次fresh critical_reviewer尝试均验收通过，独立复核2；执行摘要由work-plan直接生成并验证，bundle已CLOSED/VERIFIED、errors/warnings/anomalies=0。生成的SUBAGENT_EXECUTION_DIGEST.json及.md保存于evidence。审计只读写入观测2项均无写入，模型配置来自固定Agent TOML快照，不冒充运行时单独报告。

仅修改docs/development-preview.md和本独立task记录，无产品源码/依赖/公共合同/部署脚本变化。未归档或重新打开任何其他任务。Git提交和非强制fast-forward push将以成功后的独立收口记录确认。
