# 独立只读高风险复核

fresh critical_reviewer，task_id=oss-blocker-review-a1，结论 **BLOCKER**。复核交付完成不表示集成验收通过。

- P1：GetBucketInfo=200/name_matches=true/acl=public-read明确不满足private合同。不得在本任务修改ACL；需Bucket owner在独立授权范围处理，或提供另一明确授权private开发Bucket。未执行匿名读取探针，不声称既有对象实际暴露。
- P1：GetBucketCors和ListStagingObjects均403 AccessDenied，必要CORS和namespace证明不能完成。不能由此推断CORS本身错误、PUT一定失败或写权限缺失。必须取得必要精确读取权限并完成namespace归属确认；仅规则确需修正时再核对最小CORS写权限。
- 独立SSH：current/env SHA匹配前检；7容器ID不变、running=true/restart=0/OOM=false；API/Worker/Scheduler PID1和Settings development/openai-compatible，Settings四项OSS为空；active Jobs=0。
- before/after逐字段一致、两文件SHA均f904ca1d98698e5d2f6dfe937008edecd6f066d4c30cb74d879ae97f49d1cd56。完整DB/资源指纹采用主代理前后证据；独立SSH覆盖部署现态和active Jobs。
- 任务恢复点及文档diff准确，诊断只用stdin和进程内存、安全输出投影；git diff --check通过，复核secret marker=0。代理没有文件或远端写入。

覆盖限制：未重试OSS、未读取本机.env；未执行PUT/HEAD complete/浏览器GET/匿名拒绝/精确清理，不具有完整文件验收证据。配置未安装，无需回退。审核范围包括候选诊断、Settings/storage实现与实际文档diff。
