# 设计与恢复边界

1. 所有供应商配置仅通过现有 ADMIN UI/API 写 PostgreSQL。API Key 和敏感 Header 的替换为 write-only；先建 disabled channel/model，真实测试 PASSED 后按最新 revision 启用 model 再启用 channel。失败不自动重试，也不删除审计历史。
2. 基线固定为 `preview-20260929-082104-4e85aaf9`、7 个项目容器、3 个网络及本机/远端 staging env 的同一 SHA。记录公开健康与其他容器身份；不输出 env 内容、凭据或完整请求/响应。
3. 真实模型测试成功后，对 `.env.staging` 的单个 `CONTENT_GENERATOR` 字段构造本机候选，原文件与远端共享文件都先记录 metadata/SHA 并备份。远端以原 SHA compare-and-swap、防 symlink/普通文件/root-owned/0600 检查、Settings/Compose 校验和同目录临时文件原子安装；本机安装同一候选字节并核对双端 SHA。仅重建实际消费该设置的容器，保留数据服务、其他服务、当前 release 和 Nginx。
4. 若切换或后续业务验证失败，按备份与安装后 SHA compare-and-swap 恢复双端 deterministic 配置和原健康运行态；渠道/模型保持 disabled 或按既有合同处理，保留已产生的 Job/ContentVersion/审计。任何并发漂移拒绝覆盖并保留现场。
5. 业务验证从 generation-options/Prompt Preview 的服务端合格候选显式选择 model 与 context。发起一次有 Idempotency-Key 的命令，按返回 Job ID 跟踪终态，验证 ContentVersion、任务指针、冻结 Prompt/model/channel 身份及 Usage/Logs 安全摘要。

## 待独立复核的具体风险

- `backend/app/config.py` 定义 `CONTENT_GENERATOR`，但 `backend/app/worker.py` 调用 `process_generation_job` 未传 generator，`backend/app/services/generation.py` 似乎只在测试注入 generator 时改变执行路径。需判断 staging 的 `deterministic` 声称与实际运行合同是否相符，以及是否阻断此次仅配置接入。
- 自定义 Header 的真实供应商需求不能通过修改已终止 Production JSON 隐藏；用户仅通过管理员页面输入敏感值。
# 恢复后的执行合同（2026-09-29 晚间）

用户在获知 env 模式开关不控制 Worker、以及停用配置不能撤回已发请求后明确要求继续。本次改按现有真实适配器路径验证；不变更 env、不重建容器，原先 env 模式切换和 deterministic 回退验收由配置停用门禁取代。该选择不修复或掩盖原产品缺陷，历史 BLOCKER 保留，模式开关修复另属代码任务。

候选写入计划：

1. fresh 独立只读高风险复核 NO BLOCKER；仅复用已 PASSED 且启用的现有 channel/model，不触碰 credential/Header，不重测连接。
2. 在用户已登录的可见管理员浏览器中，用现有公开 API 创建唯一命名的合成测试 Product、PUBLIC facts draft、事实提交和批准、Platform Type、Platform Prompt、Platform Profile、Content Task。CSRF 仅在浏览器 JS 内存流转，不输出 Cookie、Token、完整请求/响应或 browser state。只输出 allowlist 的 ID、revision、状态和 HTTP status；不会直接伪造数据库状态。
3. 测试事实只描述明确的合成样本身份和验证用途，不声称真实产品参数。Prompt 要求严格四字段 JSON，tags 非空、仅依已批准事实生成。内容不自动批准或发布。创建前重新核对现有业务前置是否仍为空，以免重复创建。
4. GET generation-options，确认精确已启用模型和 Prompt revision；在可见 Content Editor/Prompt Preview 正常操作确认一次生成。使用唯一 Idempotency-Key 防止重复创建；不做无条件重试。持续只读观察该 Job，取任务/current Version/lineage 和 Usage/Logs allowlist 摘要。
5. 若生成失败，先安全分类。停用模型和渠道采用最新 revision 的公开 API；保留审计、Job、Version 和测试数据。Worker 在发起请求前检查 channel/model enabled 与 test_status；停用不能取消已通过配置检查的 RUNNING 请求（包括尚未外发的交错），也不能撤回已外发请求。执行前查本渠道 pending/running Job，执行后再次核对；本次只发起一个 Job，不重试无变化的失败。停用 revision 冲突或两步部分成功时重新读取并记录实际状态，不能声称恢复成功。发现新的实质代码缺陷立即停止扩展。
6. env、release、Nginx、网络、PostgreSQL/Redis/fake-oss 服务不修改。最终核对项目和其他容器、公网、安全摘要、diff/secret scan，并 fresh 独立高风险复核；只有修改后的验收全部达成才标记 completed。原 env checksum/权限检查仍作为未漂移证据，不能冒充运行模式切换。

恢复基线：channel=`d6e8f8b9-a5b2-4b35-b175-ac20598526af` revision=1；model=`ac74a39e-5d40-4171-b22c-34f9e57c2d75` revision=4、model_id=`deepseek-flash`、PASSED+enabled。provider brand=`OPENAI` 是管理员分类，协议=`openai-compatible-chat-completions`；不推断实际上游厂商。业务前置/Job 数量均为 0。另一个非项目容器已被外部操作替换，最终使用本次恢复基线并记录原始历史差异。
