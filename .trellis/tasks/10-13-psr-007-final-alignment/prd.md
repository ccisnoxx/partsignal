# PSR-007 Task Brief

## 目标与授权

对 PSR-001～006 做最终文档统一、残留扫描和发布前验收，不发起架构重构。用户授权文档、环境模板、注释及小型配置漂移修正，以及指定本地验证；不提交、推送、部署，不调用真实外部 AI。当前分支 `docs/PSR-007-final-alignment`，HEAD `9b588544`，工作树包含前序已接受的未提交修改。

## 依赖与状态

PSR-001～006 在维护 manifest 均为 `done`，对应 Trellis task 均为 `completed`；全部 Task Brief、实现/人工接受记录及已有独立复核记录已读取。必需依赖 PSR-004、PSR-006 满足。状态权威为 [维护 manifest](../../../docs/maintenance/openai-sdk-refactor/task-manifest.yaml)。PSR-007 按 `planned → in_progress → review` 交付，不自行 `done`、`completed` 或归档。

## 最终合同

- AI 配置、生成/自然化、Profile 诊断、API Collector 使用官方 `openai` Python SDK，继续 OpenAI-compatible Chat Completions，`max_retries=0`，支持管理员 Base URL、模型、API Key 和受支持 Header。
- 应用拥有凭据加密、业务快照、PUBLIC 门禁、严格输出 Schema、状态机、审计和指标。当前文档不宣称自研 DNS pinning、TCP peer、TLS 或 HTTP/1.1。
- GEO 当前支持人工录入与已实现 API 采集；Browser Collector、自动登录、浏览器会话材料和页面采集延期，不启用、不部署、不进入默认门禁。
- 小任务使用快速/领域入口；准备部署目标 commit 执行完整 `verify-release`。无 GitHub Actions；GitHub 用于备份与服务器拉取。Docker 交付追踪 commit SHA，无 GitHub Release/Git tag 前提；既有不可变镜像/manifest 身份要求保持。
- 内部 `max_response_bytes` 是完整接收后、业务解析前的字节检查，不能限制接收过程内存；不是公共 API/数据库字段。

## 范围与验证

具体漂移、计划文件、扫描初始结果、合同状态及停止条件见 [preflight](./preflight.md)。只修复由前序任务引入且范围小、根因明确的回归；发现功能问题先补充 preflight，超出小范围时停止、标记 blocked 并提出后续任务，不实现扩展。

实际执行并记录 `git diff --check`、`make check-fast`、`make check-ai`、`make check-geo`、`make contract-check`、`make verify-release`、Dev/Prod Compose config。领域检查使用本轮独立 PostgreSQL、本地 development 对象存储、虚构凭据和本机 HTTP fake；PG17 不能代替发布 PG16/恢复证据。

比较提交 OpenAPI、FastAPI runtime、前端生成类型；检查根数据库合同与全部历史 Alembic 文件相对 HEAD 及本轮初始基线均未变化。按用户五条命令做开始/结束扫描，对每个非空引用逐行分类。完整发布如受环境阻断，记录命令、阶段、退出码和错误，不改门禁或把未执行记为通过。

## 交付与保护

证据保存于本任务 `evidence/`，包括命令结果、扫描分类、精确增量 patch、工作区保护/清理证明及人工验收清单。前序 modified/untracked 与人工验收记录保持原文。收尾清理本轮临时数据库、存储、日志和进程，保留正式证据与共享工具缓存；检查 actual diff 和 git status。最终 manifest 与本 task 置 review，单独记录 release gate 的失败/阻断状态。
