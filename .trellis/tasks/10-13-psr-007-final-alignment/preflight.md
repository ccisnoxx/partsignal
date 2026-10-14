# PSR-007 编码前检查

2026-10-13；分支 `docs/PSR-007-final-alignment`，HEAD `9b588544`。已读根 AGENTS、RTK、Trellis workflow、相关 infra/AI 规范，PSR-001～006 全部 prd/implement/人工接受与已有 review。用户要求的 README、架构、测试、运维、生产/AI 配置、部署说明、三份环境模板、Makefile、Docker/Compose/Nginx 入口和维护 README/manifest 已检查。系统临时目录保存初始文件指纹/文档副本，保护前序工作。

## 1. 依赖与全部任务状态

| 任务 | 维护状态 | Trellis | 人工接受 |
| --- | --- | --- | --- |
| PSR-001 | done | completed | 2026-10-12 |
| PSR-002 | done | completed | 2026-10-13 |
| PSR-003 | done | completed | 2026-10-13 |
| PSR-004 | done | completed | 2026-10-13 |
| PSR-005 | done | completed | 2026-10-13 |
| PSR-006 | done | completed | 2026-10-13 |
| PSR-007 | planned（开始前） | 本轮新建 | 待审查 |

PSR-004、PSR-006 的依赖满足；记录逐项来自维护 manifest、task.json 和 implement.md 的人工接受段落，不从运行状态推定接受。

## 2. 当前实现

`AIProvider` 使用锁定的 openai 3.29.0 同步公开 Models list/Chat Completions，`max_retries=0`，关闭 redirect/环境代理。管理员 URL/Key/Header/模型由现有服务传入，应用保留加密、PUBLIC、快照、严格业务输出、revision、lease、状态、审计和可空 usage。GEO 在 SDK 方法前授权，明确 HTTP 状态为 COMPLETED，不确定网络结果 UNKNOWN，不重放同 attempt；raw bytes 完整接收后再检查大小。旧客户端与传输已删除。Browser 保留历史源码/合同和隔离资产，默认 Make/Compose 无该执行依赖。

## 3. 文档与模板漂移

- 技术方案 8.1 仍宣称自有同步 HTTP/1.1、DNS 地址固定和 peer 校验，必须替换。
- README 将 deterministic 描述为生成器，且把本地默认配置与已记录 Production 试运行混为一谈；应按实际 no-egress 模式和已有现场记录表达。
- 维护 README 混合 PSR-001/003 历史范围与当前范围，PSR-004/006 人工接受状态过时。
- operations/E2E spec 的当前运行说明仍称本地或 CI；统一为手工本地隔离运行。
- 生产配置/模板和 GEO 运维配置段仍称 R0 尚无 Collector/参数未实现，固定字段数量也滞后。改为当前 Settings、模板和输入检查的字段归属，不改配置值。
- 部署说明需显式区分 Git commit、Git tag/GitHub Release 与 Docker 镜像身份，保留不可变交付合同。

## 4. 初始残留扫描

用户指定的精确命令已执行，原输出保存于 evidence/*-before.txt（Browser 模板路径统一为仓库相对路径）。

| 扫描 | 退出码 | 命中 | 初始分类 |
| --- | ---: | ---: | --- |
| 六个旧传输符号，全仓默认 rg | 1 | 0 | 无匹配 |
| 旧客户端，backend/tests/docs/deploy | 1 | 0 | 无匹配 |
| 网络词表 | 0 | 7 | 1 处当前旧网络实现；2 处维护边界声明；1 处部署输入/真实 Gate 边界；1 历史安全报告；1 威胁条目；1 本机 HTTP fake server |
| Browser 词表 | 0 | 136 | 显式实验入口、隔离 overlay/专属测试、当前禁止/false 声明、显式选择历史 E2E 的材料准备、历史 ADR/交付/维护路径；逐行分类随最终证据交付 |
| find .github/workflows | 1 | 0 | 目录已不存在；没有工作流文件，不把 find 的非零伪装为测试通过 |

## 5. 计划修改文件

README.md；docs/architecture.md、testing.md、operations.md、production-configuration.md、Hostdzire部署上线流程.md、Hostdzire部署附录.md、GEO系统前后端技术与部署方案.md；三份 .env*.example 注释；GEO 当前运维配置段及对应 CHANGELOG/SHA256SUMS；.trellis/spec/infra/e2e-isolation.md；维护 README/manifest；本任务记录与证据。Makefile、业务源码、测试、部署执行器和 Compose/Nginx 无预期修改。

## 6. OpenAPI、数据库、Alembic

`git diff --name-status -- contracts backend/alembic frontend/src/shared/api/generated` 无输出；Alembic heads=`0066_geo_manual_evaluation (head)`。PSR 工作流没有根合同或历史迁移 diff。`max_response_bytes` 仅内部 CollectionRequest/Collector/测试出现，无公共或数据库字段；本轮不变语义。三方 Schema/生成类型实测由 contract-check 完成。

## 7. 验证计划

集中实际执行用户六个最低检查及 Dev/Prod Compose config；完整发布仅因本次明确要求而执行。领域环境使用随机回环 PG17 与本地 development 存储，不借用业务库/生产 Bucket/凭据。Docker info 已确认 daemon socket `/var/run/docker.sock` 不存在；verify-release 仍实际尝试，按失败阶段报告。补充文档链接、模板键值不变、GEO 校验和、默认 Make 传递展开及保护指纹检查。

## 8. 风险与停止条件

前序变更多且未提交，证据绑定当前工作树指纹，不能称目标 commit 已验证或发布。PG17 与宿主领域检查不能替代 PG16、Linux 镜像、Redis/Celery、完整 Playwright 或现场真实服务。依赖非 done、必须大范围修复前序回归、公共合同/数据库迁移变化、必须真实供应商/秘密验证或无法保护其他工作时停止并 blocked。环境失败精确记录，不能降低安全/业务检查。当前没有确认的功能性回归，不计划代码修复。
