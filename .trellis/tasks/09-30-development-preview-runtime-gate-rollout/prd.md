# 开发预览运行模式门禁受控部署

parent=null。用户明确授权本独立部署任务，源码精确固定 `2f17130055439f59dfc11fed42ada47d066c71cf`。范围为 Hostdzire staging，现有数据升级、单字段 env 切换、一次真实 AI 生成和 Git 收口。

## 验收

- release/archive/image 身份可追溯；不包含原检出区用户 AGENTS.md 改动或私有 env。
- env 只改变 CONTENT_GENERATOR；API/Worker/Scheduler 同 release、同模式。
- PostgreSQL/Redis/fake-oss 数据、账号、AI 配置、历史 Job/Version 保留；无 clean-init、Production、OSS 或历史清理。
- 前后两次 fresh critical_reviewer；有效 SUBAGENT_EXECUTION_DIGEST。
- 健康、公网四项精确200、六安全头、三网络及非项目容器无漂移。
- 只创建一个新任务和一个真实 Job；SUCCEEDED/attempt=1/AI DRAFT/lineage/Usage；不重测模型、不批准或发布内容。
- 全部验收后原子切 current；旧 release/image、配对 env/数据库备份保留。
- 仅任务记录和过期开发预览文档提交并非强制 fast-forward push；worktree clean；原检出区 AGENTS diff SHA 前后一致。

## 验证复用

9a2d29b6 完整 make verify exit0（日志SHA 6be630b5f979a05e6c6ca5dd2bc94461a7b1dae4694360cd6340510fa3b07c78）及最终 NO BLOCKER；到2f171300只有三个Trellis收口记录文件改变。无需重跑全门禁。新增部署态证据。
