# 整分支已确认阻断修复

范围：只修复 8b2e0dc8 收尾报告中确认的三类后端测试合同缺漏、两项前端缓存竞态及 Overview/Insights 能力说明。GEO-1007 恢复 accepted_commit=baea420f 不变，不扩大业务功能或重做其真实 Compose 演练。

验收：会话 fixture 提供真实 id/db.info；metadata inventory 同步实际 OpenAPI 且保留逐 operation 语义；head 测试精确更新到0066并保留合法0065阶段测试；写后取消首个旧 list GET并保留 principal fence；删除不重读详情且过滤旧行；页面说明准确限定范围。

验证成本：两支并行修复，各自最小定向检查；稳定候选一次独立只读复审；固定新SHA的完整门禁与CI各一次，失败先诊断，仅重跑直接受影响部分，保留其他成功证据。不得循环全量测试、重建镜像/清缓存或降低断言来换通过。

授权：用户已要求修整分支阻断，并要求避免反复验证花费一两个小时。此前提交推送授权沿用。不合并 main、不冻结 RC、不生产部署；这些需实际准入满足。

依据：docs/geo-monitoring/06-reviews/2026-10-06-v1-post-recovery-blocker-audit.md 与其 evidence/independent-pr-review-d2aefec7.md。其他任务 review 不自动接受。

CI失败后必要修复：宿主直接pytest缺对象存储、容器合同挂载和PG16工具，改接已有make test-integration；其执行源码和测试未变，复用已通过本地完整门禁，仅检查新增CI调用与固定SHA独立复审。不再次触发小时级全量；远端未验证如实保留。
