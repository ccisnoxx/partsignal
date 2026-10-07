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
