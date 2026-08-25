# Frontend V2 Phase 9 Staging 接入

## 目标

把仓库中 staging Compose 名为 `frontend` 的静态站点 owner 从 `frontend/` 切换为 `frontend-v2/`，保留 V1 源码、镜像标签能力和旧 release 回滚路径，并以本地门禁证明 artifact 与配置合同。

## 范围

- 为 `frontend-v2/` 提供可部署的多阶段 Docker 镜像、Nginx SPA fallback 和精确 Docker build context。
- 保持 staging 的 `frontend` service 名称、镜像变量、端口、上游、网络和资源限制不变，只切换 build context。
- 明确禁用 V2 production source map，并验证浏览器不可获取 `.map`。
- 复用现有外层 staging Nginx、安全头和完整发布脚本；补充必要的静态/容器回归检查。
- 更新 staging runbook 及 Phase 9 验收记录，使 V2 owner、验证步骤、授权点和 V1 回滚命令可审计。

## 不在范围

- 不修改 backend、数据库、OpenAPI、权限或业务状态。
- 不修改 production Compose、production Nginx、DNS、证书或生产入口。
- 不实现 V1→V2 legacy redirect map；该工作属于后续 `frontend-v2-phase-9-legacy-routing`。
- 不做 production-like rehearsal、production artifact 准备、回滚演练或正式 cutover。
- 不删除 `frontend/`、V1 镜像、旧 release 或任何 V1 pipeline。
- 不创建并行 V1/V2 service、通用 deployment framework、feature flag 或新的外部资源。
- 不使用 fast redeploy 激活本次变更：`deploy/compose.staging.yaml` 属于其关键路径，必须走完整 staging runbook。
- 不执行外部 Staging Gate。用户于 2026-08-25 确认将只读盘点、发布、浏览器验收和必要回滚延后到独立任务 `frontend-v2-phase-9-staging-activation-validation`。

## 需求

1. `frontend-v2` 镜像必须从锁定依赖构建静态产物，并由 Nginx 提供。
2. `/login`、`/` 和任意已存在的 V2 client route 直接访问及刷新必须返回 SPA；不存在的 `/assets/*` 不得 fallback 到 `index.html`。
3. hashed assets 必须带 immutable cache，`index.html` 和 client-route fallback 必须禁止缓存。
4. V2 production build 必须显式 `sourcemap: false`；镜像和公开 HTTP 均不得暴露 `.map` 或 `sourceMappingURL`。
5. API 继续使用同源 `/api` 合同，不引入 staging 专用 API 默认值或 CORS 兼容层。
6. CSP 与其他安全头继续由现有外层 staging Nginx 唯一拥有；容器 Nginx 不复制这些头。
7. `make build` 必须实际构建 V2 production 镜像；部署脚本门禁必须冻结 staging build context 和现有发布命令序列。

## 验收标准

### 仓库与本地门禁

- [ ] `frontend-v2/` 有最小 Dockerfile、Nginx 配置和 `.dockerignore`，且未新增依赖或部署抽象。
- [ ] `deploy/compose.staging.yaml` 仅将现有 `frontend` service 的 build context 切到 `../frontend-v2`，其他 runtime owner 不变。
- [ ] V2 production build 显式禁用 source map。
- [ ] 可重复的本地容器检查证明 SPA fallback、asset 404、缓存策略和 source map 策略。
- [ ] 安全检查同时覆盖 V1/V2 index、容器 Nginx ownership 和 V2 源码危险 DOM sink；V1 专有 theme/Markdown owner 检查保留。
- [ ] `make build`、部署脚本门禁及相关前端质量门禁通过。
- [ ] V1 源码、镜像构建能力、旧 release 和 production 配置未删除或改写。

### 后续独立任务合同（不计入 P9.1 验收）

- [ ] 只读盘点确认 `https://geo.962850.xyz`（或用户确认的实际 URL）确为 staging，且上一 V1 release/tag 可回滚。
- [ ] 目标 staging 运行的仓库 commit 与已批准提交完全一致，并通过完整 staging runbook 激活。
- [ ] loopback API、首页和公开 HTTPS 健康检查通过。
- [ ] `/login`、`/`、核心列表、Workspace 与 ADMIN System 路由的直接访问、刷新、前进/后退及权限行为符合 V2 合同。
- [ ] JS chunks/assets 全部成功加载，缓存头正确，公开 `.map` 不可获取，控制台无未处理异常、请求失败或 CSP violation。
- [ ] 验证过程未创建、修改或删除生产/业务数据。
- [ ] 任一失败判据触发时，按预先确认命令恢复上一 V1 release 并复验；不得以修改数据库或删除新 release 代替回滚。

## 外部授权点

1. 仓库修改完成后，先提交 commit 计划并等待用户确认，才可提交。
2. 提交后，push 是独立外部 Git 写操作，必须另获授权。
3. staging 只读盘点、发布激活和回滚分别属于远程操作；必须在执行前确认目标、凭据边界和上一 V1 release。
4. staging 验证只允许读操作。任何需写业务数据、改 DNS/外层代理、改 schema/backend 或接触 production 的情况立即停止并拆分任务。

以上外部授权点由 `frontend-v2-phase-9-staging-activation-validation` 持有；P9.1 不执行这些操作，也不以其 `PENDING` 状态阻塞归档。

## 停止条件

- 工作区不在 clean `main`，或出现无法归属的修改。
- 真实环境无法证明为 staging，远程 commit 与批准 commit 不一致，或发生 SSH host-key 冲突。
- 上一 V1 release/tag 不存在、不可启动或与当前数据库不兼容。
- 接入必须改动 production、数据库、backend/API 合同、DNS、证书或外层安全边界。
- 同源 API、cookie/CORS、CSP、缓存、deep link、chunk 或 source map 任一门禁失败。
- 完整 runbook 的备份、迁移前置检查或健康检查失败。
