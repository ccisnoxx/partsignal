# Frontend V2 Development Cutover 与 V1 Retirement

## 目标

在仍处于开发阶段、业务数据允许丢弃且数据库允许重建的前提下，将当前 `frontend-v2/` 提升为仓库唯一 canonical `frontend/`，直接退役旧 `frontend/`（V1）及其源码、测试、构建入口和双前端流水线，并让开发、CI、Compose、部署检查、安全检查、E2E 与现行文档统一指向单一前端。

本任务是开发阶段的仓库切换，不是 Production 发布、Production candidate 冻结或远端环境迁移。

## 已确认范围

### 范围内

- 从干净的 `main` 创建实施分支 `codex/frontend-v2-development-cutover-v1-retirement`，不得以当前 candidate 分支为基线。
- 删除现有 V1 `frontend/` 的源码、测试、快照、构建配置和专属检查。
- 将 `frontend-v2/` 迁移为唯一 canonical `frontend/`，并更新其项目级 `AGENTS.md` 路径说明。
- 将 Makefile、GitHub Actions、开发/预发 Compose、部署脚本与测试、安全检查、容器检查、E2E 和相关文档改为单前端路径与语义。
- 保留 V2 已实现的 legacy URL 重定向与后端 V1 compatibility endpoints；它们是兼容合同，不构成第二套前端。
- 安全终止五个尚未实施的 `frontend-v2-production-*` planning task，明确记录 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`，并使用不自动提交的归档方式。
- 对代码、合同、测试、Trellis specs 和现行设计/运维文档做一致性检查。

### 范围外

- Production candidate 冻结或 artifact gate。
- clean-init、隔离环境全流程演练、Production Cutover、Production Observation。
- Hostdzire 或任何其他远端主机操作。
- 本机 Docker/container smoke、隔离 real-stack E2E 与最终聚合 `make verify`；用户明确不要求本机隔离容器测试，这些检查对本任务为 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`，不能记为 `MET`。
- Production 流量切换、镜像构建/推送/删除、release/quarantine 操作。
- 删除或改写任何远端数据、镜像、release、quarantine 或环境文件。
- 自动合并、删除当前 `codex/frontend-v2-production-candidate-artifact-gate` 分支、push 或提交。
- 自动创建或实施后续任务。
- 将 `docs/frontend-v2/` 的历史文档目录重命名；历史阶段、release、镜像与 task 标识保持原样。
- 仅因源码目录切换而重命名现有 Production image/env/tag/project/data-root 或应用品牌标识。

## 验收标准

- [ ] 实施基线明确为 `main == origin/main` 的干净工作树；当前 candidate 分支未合并、未删除、未修改。
- [ ] 仓库只保留 canonical `frontend/`；`frontend-v2/` 不再存在；canonical 内容来自原 V2，旧 V1 源码、测试、快照与专属构建逻辑已删除。
- [ ] canonical 前端 Dockerfile 同时满足开发 Compose 所需的 `development` stage 和 V2 Production Nginx 构建要求；开发端口与 `compose.dev.yaml` 一致。
- [ ] Makefile 和 CI 只安装、检查、测试、构建一个前端；V1 visual/theme-init 专属任务已删除，V2 unit、Storybook、设计系统和 E2E 覆盖保留。
- [ ] dev、staging、prod Compose 及相关脚本不再引用已删除的源码目录；现有 V2-only Production 安全机制保留，未引入当前 candidate 分支的 Hostdzire 本地镜像流程。
- [ ] 中央安全检查只扫描 canonical `frontend/`，保留 CSP、Nginx、DOM sink、Markdown sanitizer、敏感数据与本地路径检查，并与 V2 的生产环境无 source map 合同一致。
- [ ] 根 E2E 不再启动或执行 V1；real-stack 与 fixture suites 的活动入口迁移到 canonical 路径。当前任务实际执行 fixture suite；本机隔离 real-stack 按范围决策不执行。
- [ ] 五个 Production planning task 均记录：生命周期可以是 `completed/archived`，但业务结果是 `CANCELLED_BY_SCOPE_DECISION`、Gate 是 `NOT_APPLICABLE`，且未执行任何远端或 Production 操作。
- [ ] 现行代码、合同、Trellis specs 与文档对 canonical 路径、单前端流水线和取消的 Production Gates 描述一致；历史记录不被改写成已执行结果。
- [ ] 范围内 required validation 全部通过；本机 container/real-stack/`make verify` 和未执行 Production Gate 均记录为 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`，不得标记为 `MET`。
- [ ] 提交前先向用户给出 commit plan 并获得确认；不自动 push。

## 成功判定

成功仅表示开发仓库完成单前端切换并通过本地验证。它不表示 Production readiness、Production candidate、clean-init rehearsal、Production Cutover 或 Production Observation 已完成。

## 停止条件

- 实施分支无法从干净 `main` 创建，或发现来源不明的 dirty/untracked 文件可能被覆盖。
- `frontend/` 与 `frontend-v2/` 的迁移出现无法安全区分的路径冲突、符号链接或用户生成内容。
- 需要操作远端主机、Production 数据、镜像、release、quarantine 或环境文件才能继续。
- 需要削弱 V2 安全合同、E2E 清理隔离或现有 Production 数据状态保护才能让检查通过。
- required validation 出现可归因于本任务的失败且不能在既定范围内正确修复。
- 发现必须改变公共 API、数据库合同或权限模型而当前任务没有明确授权。

## 约束备注

- 当前 candidate 分支相对 `main` 的提交和文件差异只服务于已取消的 Hostdzire candidate 流程及其 Trellis bookkeeping，不作为本任务实现来源。
- 旧 `frontend/` 本地可能含忽略的 `node_modules/`、`dist/`、测试产物；迁移必须先精确确认目录，再使用可恢复的临时位置避让，禁止 `git clean`、`git reset --hard` 或宽泛删除。
- AI 新增或实质修改的开发者可见注释、docstring、日志、异常和文档默认使用中文，并在最终报告说明 touched-scope documentation pass 结果。
