# Frontend V2 Phase 9 Cutover 总体规划

## 1. 目标

只审计当前仓库与已归档证据，形成一条可逐项规划、批准、实施、验证、提交和回滚的 Frontend V2 Cutover 路线。本 Task 不实施部署、不连接远程环境、不切换任何入口、不修改产品/CI/部署/合同/配置，也不删除 V1。

## 2. 已满足的启动前提

- 审计开始时主工作区位于 clean `main`；未执行 `pull`。
- 创建本 Task 前没有 active Trellis Task。
- Phase 8 父任务及其登记的 13 个子任务均已归档且 `completed`。
- `docs/frontend-v2/07-migration-plan.md` 与 `08-testing-quality-and-acceptance.md` 均记录 Phase 8 Exit Gate=`MET`。
- 规划完成并获用户批准后，已运行 `task.py start`，当前位于唯一授权分支 `codex/frontend-v2-phase-9-cutover-planning`。

`07`、`08` 中“Phase 8 父任务未归档”的句子是收尾时的历史快照，已被后续归档事实取代；不影响 Gate=`MET`。

## 3. 本规划必须回答的合同

1. 区分仓库可证明的 staging 入口、production 形态配置与无法确认的外部实时事实。
2. 明确 V1/V2 的 build artifact、container、反向代理、SPA fallback 与静态资源 owner。
3. 给出 V2 staging 接入的精确文件边界，避免新增长期双栈或通用 deployment framework。
4. 定义 production-like data rehearsal 的隔离、脱敏、副作用禁止与销毁边界，保证 production 数据零写入。
5. 定义 V1→V2 redirect map 及 direct/refresh/Back/Forward/未知路径验证。
6. 定义 `/login`、`/`、核心列表、Workspace、Settings/System 路由的认证、强制改密、ADMIN/ENGINEER 与服务端权限验证。
7. 定义 API base URL、lazy JS chunk、asset/index cache、CSP、source map 与错误观测的 Cutover 要求。
8. 定义正式切换前置授权、观察窗口、硬失败、阈值失败与回滚触发条件。
9. 把 Cutover Gate 写成可观察的 `MET`/`NOT_MET` 判定。
10. 将 `frontend/` 与 V1 pipeline 删除保留为观察完成后的最后一个独立、可回滚 Task。

## 4. 范围

### In scope

- 仓库内代码、配置、测试、文档、Trellis 任务和 Git 状态的只读审计。
- 本规划 Task 的 `prd.md`、`research/*.md`、`design.md`、`implement.md`、`task.json`。
- 七个候选子 Task 的依赖、单一目标、Required Validation、外部授权点、停止条件、回滚边界和建议提交范围。
- 对外部未知事实列出精确待确认项，不猜测主机、平台、域名、监控或生产发布 owner。

### Out of scope

- 修改任何产品、backend、frontend、frontend-v2、deploy、CI、合同、配置或权威运维文档。
- `pull`、`push`、PR、SSH、DNS、Nginx reload、部署、rehearsal、浏览器远程验收或 Git 历史改写。
- 创建/删除外部资源、修改 staging/production 数据、切换生产入口或删除 `frontend/`。
- 创建或启动任何 Phase 9 子 Task。
- 提前实现 redirect、source map、telemetry、publisher、rollback tooling 或通用 deployment framework。

## 5. 最小子 Task 图

```text
P9.1 staging integration
  └─ P9.2 legacy routing & deep-link compatibility
       ├─ P9.3 production-like data rehearsal
       └─ P9.4 production artifact & rollback readiness
              └──────────────┐
P9.3 ────────────────────────┴─ P9.5 rollback drill
                                  └─ P9.6 production cutover & observation
                                       └─ P9.7 V1 retirement
```

候选 Task ID：

1. `frontend-v2-phase-9-staging-integration`
2. `frontend-v2-phase-9-legacy-routing`
3. `frontend-v2-phase-9-production-like-rehearsal`
4. `frontend-v2-phase-9-production-artifact-readiness`
5. `frontend-v2-phase-9-rollback-drill`
6. `frontend-v2-phase-9-production-cutover`
7. `frontend-v2-phase-9-v1-retirement`

P9.3 与 P9.4 可在 P9.2 合入后独立规划；它们不得共享未提交改动。其余严格串行。每个 Task 从最新 clean `main` 开始，前一依赖已提交后才创建；不预建子 Task 目录或 branch。

## 6. 本规划 Task 验收条件

- [x] 启动前提、Phase 8 归档与 Exit Gate 已有仓库证据。
- [x] 完整审计指定架构/路由/测试文档、Makefile/CI、deploy 配置与脚本、V1/V2 build/route/runtime owner。
- [x] `research/audit.md` 区分仓库事实、外部未知、部署 ownership 与 Cutover gaps。
- [x] `design.md` 定义 staging 精确文件、数据演练、redirect/fallback/权限、artifact、安全、观察、Gate 与回滚。
- [x] `implement.md` 给出七个最小子 Task 的依赖、Required Validation、授权点、停止条件、回滚和建议提交范围。
- [x] 规划阶段未创建 branch、未运行 `task.py start`、未连接远程、未实施任何 Phase 9 工作、未删除 V1。
- [x] 用户批准本规划后，已启动本 planning Task 并创建唯一临时分支 `codex/frontend-v2-phase-9-cutover-planning`。

## 7. 规划批准后的边界

批准本规划不等于批准任何 staging/production 外部操作，也不等于批准七个子 Task。批准后只允许：启动本 planning Task、创建已授权的唯一临时分支、验证并提交规划 artifacts。每个 Phase 9 子 Task 仍需独立创建、规划和批准；所有外部读写在对应 Task 中再次取得精确授权。
