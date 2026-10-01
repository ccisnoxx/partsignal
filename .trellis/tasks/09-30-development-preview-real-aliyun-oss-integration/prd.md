# 开发预览真实 Aliyun OSS 接入与完整文件流程验收

parent=null；scope=deployment/integration。用户只授权本开发阶段任务，完成或阻断后停止，不创建 Production、Observation 或其他后续任务。

基线 origin/main=9dcbfd81ee42265f4f90c3923975ddba186f795d；Hostdzire current/release=preview-20260930-111500-2f171300；源码=2f17130055439f59dfc11fed42ada47d066c71cf。独立 Codex 托管 worktree 和分支 codex/development-preview-real-aliyun-oss-integration，原检出区及 frontend-redevelopment worktree 不实施。

## 验收合同

- 仅改变 OBJECT_STORAGE_BACKEND 和四项 OSS 配置；其他 staging 配置逐键逐值保持，真实 AI 保持 openai-compatible。
- Bucket 身份由用户确认；2026-10-01 用户明确取消强制 private 要求，接受保留现有 Bucket ACL，不因 public-read 单独阻断。staging/ namespace 仍须归属明确，已有其他项目对象不得覆盖或删除。精确 Origin https://geo.962850.xyz 允许 PUT/GET/HEAD、Content-Type、x-oss-meta-sha256；非允许 Origin 无有效 ACAO；只在确有缺项时备份并最小修正 CORS。
- 配置写入前 fresh critical_reviewer 结论 NO BLOCKER；受限 env 备份、原 SHA 门禁、协作锁及原子安装。只重建 API/Worker/Scheduler，固定 project、现有 release/image、--no-build --pull never。
- 唯一 UUID 小 PNG 从正常平台 Logo UI 上传，不保存平台表单：真实签名 HTTPS PUT、后端真实 HEAD complete、VERIFIED size/hash/type、短期浏览器 GET 字节/hash/type一致；匿名/无效签名访问记录实际行为。public-read 下不得宣称签名过期等于对象不可访问，不以匿名读取被拒绝作为本轮硬性完成条件。
- fake-oss 不写入本次对象；只安排并执行本任务未引用文件清理，OSS 删除、DB DELETED 墓碑、下载/HEAD失效。
- 不创建 AI Job，不调用供应商，不审核或发布；数据、AI历史、current/release/image/schema/Nginx/Compose连续。
- 最终 fresh critical_reviewer NO BLOCKER、有效 SUBAGENT_EXECUTION_DIGEST、diff check 和 secret scan clean。只提交本 task 与必要开发预览文档；非强制 fast-forward push main，工作区 clean，原 HEAD/AGENTS diff 与其他 worktree保持。

产品源码、公共合同、schema、Compose、Nginx、部署脚本、依赖、镜像和 release 不修改。复用上轮完整 make verify 与代码独立复核。若外部权限/CORS/归属阻断则停止；若产品缺陷必须修复则记录独立 blocker 子任务，恢复运行态后结束，不在本会话修复。

## 2026-10-01 用户修订

取消 Bucket 必须保持 private 的任务要求，不授权修改共享 Bucket ACL。此前 private 阻断已解除；CORS读取/修正权限和staging namespace隔离证明仍须成立。当前适配器没有设置对象ACL，文件会继承Bucket ACL；public-read可能使已知对象URL可匿名读取，下载URL签名期限不构成对象整体访问期限。此限制必须在候选独立复核、真实验收和最终记录中明确，不能作为私有访问验收通过。原禁止产品源码/公共合同/schema/部署改动及其余受控切换要求保持。


## 2026-10-01 后续用户指示

用户要求浏览器向应用后端传输文件，再由后端写入OSS；本轮仅交付源码与定向验证，保留当前staging release。原完整外部集成验收尚未完成，不能按原完成判据标记completed。实现子任务只完成已授权的上传改造，并在结束后停止，不发起未来部署、Production或Observation任务。
