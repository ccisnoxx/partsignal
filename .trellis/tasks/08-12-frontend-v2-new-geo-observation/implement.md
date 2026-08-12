# Frontend V2 New GEO Observation 实施计划

## 审批门

- [x] 用户已确认方案 A：recommendation/citation 作为旧表单遗留行为移出本 Task。
- [x] 用户已批准本次更新后的最终规划摘要。
- [x] 已确认 primary working directory 基线为最新且干净的 `main`。
- [x] 已从该基线创建 `codex/frontend-v2-new-geo-observation`。

Trellis Task 已启动；提交、归档和 push 仍须遵循后续审批门。

## 实施顺序

### 1. 收紧合同与生成类型

- 为 `POST /api/v1/geo-observations` 声明实际 401/403/404/409/422 结构化错误响应。
- 按最终批准的 article result 字段确认 OpenAPI 与后端 schema 一致。
- 再生成 V1/V2 TypeScript schema；V1 仅接受机械生成变更，不修改业务 UI。

### 2. 扩展 GEO API 边界

- 在既有 `geoKeys` 下增加 creation/candidate query key 与 create mutation API。
- 接入 Product 服务端搜索、Query Topic 和 GEO Published Article candidates。
- 增加可测试的 payload 构建与 server issue 映射；不增加第二套 DTO。

### 3. 实现表单模型与窄上传组件

- 建立与 generated types 对齐的 RHF/Zod 模型。
- 明确建模 article result 的未选择状态，禁止用初始 `false` 表示用户判断。
- 把既有 SHA-256 与对象存储 transfer 纯协议函数提取到窄 shared API helper，并让 Publication/GEO 同时复用；不提取 UI、状态机或领域错误。
- 实现 GEO evidence 上传三阶段状态与 complete retry。
- 先写最小模型/API/上传行为测试，再进入页面组合。

### 4. 实现 Workspace 页面

- 组合 `WorkspaceShell`、Form Kit、`DirtyGuard`、`StickyActionBar`。
- 实现 Product/Topic 初始读取、Product 依赖候选读取，以及 loading/empty/error/retry。
- 实现响应式 article result 字段组、附件、notes、tested time、错误摘要与焦点行为。
- 用提交锁和 `isPending` 确保单次 POST。
- 409 时只刷新候选并保留仍有效输入，不自动重提。

### 5. Route、入口与成功交接

- 注册 `/geo/observations/new`，再生成 route tree。
- 从 Observation List 增加创建入口。
- 成功后清 dirty，invalidates GEO list 与 Product detail，并导航 canonical Observation List。
- 确认没有新增 Observation Detail route 或占位页。

### 6. Fixture E2E 与文档

- 扩展 generated-type GEO fixture，保持其编译期合同约束。
- 覆盖 happy path、权威候选、结构化错误/409 refresh、pending 防重、DirtyGuard 和 responsive/a11y 关键断言。
- 同步 API/action、migration status 与验收文档；既有 ADR 已覆盖的决策不重复记录。

### 7. 自审与交付

- 对照 diff 检查第二来源、兼容 fallback、默认 `false`、自动 mutation replay、跨域 UI 依赖、占位 route、无关编辑。
- 展示提交计划并等待用户确认后才 commit。
- 获得合并授权后合并回 `main`；不得自动 push。
- 合并完成后删除本地和远程临时分支；远程分支仅在它确实存在且删除动作获授权时处理。

## Required validation

以下命令在实现后直接证明本 Task 的合同和行为：

```bash
npm --prefix frontend-v2 run api:generate
npm --prefix frontend run api:generate
make contract-check
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py -q
npm --prefix frontend-v2 run test -- src/shared/api/file-transfer.test.ts src/domains/publication/publication-evidence-upload.test.tsx src/domains/geo/geo.api.test.ts src/domains/geo/new-geo-observation.model.test.ts src/domains/geo/geo-evidence-upload.test.tsx src/domains/geo/geo-observation-list-page.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend run typecheck
npm --prefix frontend-v2 run e2e -- tests/e2e/geo-observations.spec.ts tests/e2e/new-geo-observation.spec.ts
git diff --check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/08-12-frontend-v2-new-geo-observation
```

若最终范围没有独立 uploader 测试文件，则从 targeted test 命令删除该路径；不得创建空测试只为满足预写命令。

## Optional full-suite validation

这些检查覆盖更大范围，但当前增量不默认要求全部运行：

```bash
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
make test-unit
make test-integration
make verify
```

GEO 完整 real-stack 闭环明确排除。只有最终实现触及共享数据库合同、核心权限/状态转换、发布准备，或 targeted evidence 暗示跨模块回归时，才升级运行对应 full suite。

## 验收映射

| 风险/行为 | 主要证据 |
|---|---|
| generated contract 一致 | api generation、contract-check、V1/V2 typecheck |
| 候选权威与 payload 完整 | API/model unit tests、fixture E2E |
| 上传状态与重试 | uploader component test、E2E |
| 结构化错误与 409 refresh | API/model tests、E2E |
| pending 防重与 DirtyGuard | generated-type E2E |
| canonical invalidation/handoff | page/list tests、E2E |
| 响应式、键盘、焦点 | 375/768/1024/1440 production-artifact E2E |
| 不破坏 append-only | payload test、无 detail/correction route、diff 自审 |
