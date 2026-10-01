# 配置、secret 与恢复边界

输入仅从原检出区忽略 .env 逐行筛选四项 OSS 键，拒绝重复/空值；标准 OSS 区域 hostname 若无协议，候选明确补 HTTPS，不修改输入文件。Bucket 名合法，归属由用户确认和只读 namespace/ACL检查共同建立。凭据只在内存和 SSH stdin、root-only 0600 临时材料流转，不进入 argv、普通日志、证据或 Git。响应只投影布尔、状态、hash；不保存预签名 query、Cookie或密码。

运行配置 owner=/root/partsignal/shared/.env.staging；release=.env.staging 链接保持不变。原文件先备份至独立0700目录/0600文件。候选原始字节只替换五个精确键，解析逐键比较其余键。当前 backend image 隔离 Settings 和 Aliyun adapter 构造检查；安装前验证原 SHA、current、image、active Jobs=0，维护周期使用固定协作锁。只重建 API/Worker/Scheduler，--no-deps 防止重建 fake-oss 和数据服务；显式 project/release/version、--no-build --pull never。

CORS写入仅在身份/权限明确且现有规则缺少精确应用Origin时，备份原始 CORS到受限文件，保留其他规则，不改 ACL、生命周期、版本控制或其他策略。2026-10-01用户取消强制私有性门禁；保留现有Bucket ACL。namespace归属或必要CORS权限不明确仍停止。

失败恢复入口：持同一锁，停止三消费者、验证原env备份和候选SHA，0600同目录暂存后原子恢复原.env.staging，再使用同一release/image、固定project及--no-build --pull never重建三消费者。验证development/openai-compatible与健康；不回滚DB，不删除业务历史。先清理由本任务创建且精确识别的对象和记录，保留DELETED墓碑。若必要CORS写入失败恢复原CORS。

正常验收使用已有ADMIN会话正常平台Logo上传，不保存业务表单。清理前通过现有服务确认唯一文件无引用；必须确认一次 cleanup_file_records 所选只有本任务文件，不能借全局扫描清理历史。若无法安全限定则不修改源码，记录blocker并恢复配置。

完整门禁复用2f171300已有证据；新增证据只覆盖真实OSS/运行态/文件流程与资源连续性。独立前后两次只读高风险复核使用fresh隔离critical_reviewer，并生成持久审计摘要。

## public-read 的当前验收边界

用户确认本机输入所指Bucket，并说明其被其他项目使用；不修改Bucket ACL，不将确认Bucket身份等同于确认staging namespace专属。当前源码上传没有指定对象ACL，保留public-read会使新文件继承Bucket公开读权限。浏览器预签名PUT、HEAD complete和短期签名GET仍可验证；匿名读取应记录真实结果，不伪称私有性或下载签名过期能阻止匿名访问。此项变更只更新开发预览任务要求，不改变产品源码、其他环境合同或原历史证据。


## 2026-10-01 当前执行范围

以上为原无源码配置切换方案的历史恢复记录。用户最新要求由后端中转上传，且本轮保留现在线release；新源码设计由实现子任务拥有。未安装候选env、不修改Bucket CORS、不重建服务；旧独立复核仅对应旧合同，新的源码候选安排fresh独立复核。
