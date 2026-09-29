# 设计与恢复边界

1. 所有供应商配置仅通过现有 ADMIN UI/API 写 PostgreSQL。API Key 和敏感 Header 的替换为 write-only；先建 disabled channel/model，真实测试 PASSED 后按最新 revision 启用 model 再启用 channel。失败不自动重试，也不删除审计历史。
2. 基线固定为 `preview-20260929-082104-4e85aaf9`、7 个项目容器、3 个网络及本机/远端 staging env 的同一 SHA。记录公开健康与其他容器身份；不输出 env 内容、凭据或完整请求/响应。
3. 真实模型测试成功后，对 `.env.staging` 的单个 `CONTENT_GENERATOR` 字段构造本机候选，原文件与远端共享文件都先记录 metadata/SHA 并备份。远端以原 SHA compare-and-swap、防 symlink/普通文件/root-owned/0600 检查、Settings/Compose 校验和同目录临时文件原子安装；本机安装同一候选字节并核对双端 SHA。仅重建实际消费该设置的容器，保留数据服务、其他服务、当前 release 和 Nginx。
4. 若切换或后续业务验证失败，按备份与安装后 SHA compare-and-swap 恢复双端 deterministic 配置和原健康运行态；渠道/模型保持 disabled 或按既有合同处理，保留已产生的 Job/ContentVersion/审计。任何并发漂移拒绝覆盖并保留现场。
5. 业务验证从 generation-options/Prompt Preview 的服务端合格候选显式选择 model 与 context。发起一次有 Idempotency-Key 的命令，按返回 Job ID 跟踪终态，验证 ContentVersion、任务指针、冻结 Prompt/model/channel 身份及 Usage/Logs 安全摘要。

## 待独立复核的具体风险

- `backend/app/config.py` 定义 `CONTENT_GENERATOR`，但 `backend/app/worker.py` 调用 `process_generation_job` 未传 generator，`backend/app/services/generation.py` 似乎只在测试注入 generator 时改变执行路径。需判断 staging 的 `deterministic` 声称与实际运行合同是否相符，以及是否阻断此次仅配置接入。
- 自定义 Header 的真实供应商需求不能通过修改已终止 Production JSON 隐藏；用户仅通过管理员页面输入敏感值。
