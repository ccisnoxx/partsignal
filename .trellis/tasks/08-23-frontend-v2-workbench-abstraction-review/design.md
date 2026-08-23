# Frontend V2 Workbench Abstraction Review Design

## 1. Design Decision

不重构 Workbench vertical slice。现有 owner 与依赖方向正确，本 Task 只做一项安全根因修复、两处删除式局部简化和最终文档闭环；没有真实消费者支持新增 shared/domain/framework。

核心 invariant：

```text
PostgreSQL / 原领域 predicate 与 action helper
                  |
                  v
backend Workbench service
  counts / health / GEO / attention / sort / canonical href
                  |
          GET /api/v1/workbench
                  |
                  v
Workbench query options（唯一 TanStack Query owner）
                  |
          route loader + page
                  |
                  v
Workbench-local presentation -> Design System primitives/shared transport
```

任何层都不得向上游反向依赖：shared 不认识 Workbench DTO/业务状态；frontend 不重建 service 资格；service 不复制原领域写状态机。

## 2. Owner Decisions

### Backend Read Model

- `backend/app/services/workbench.py` 保持六类 count、四域 health、GEO window/rate、attention 合并/排序、canonical href 唯一 owner。
- router 的 `REPEATABLE READ` dependency 是可见的 I/O 生命周期边界，保留；它不是需要抽象的薄 wrapper。
- `WorkbenchRate`/`WorkbenchWindow` schema validator 保护合同数据完整性，保留。
- `WorkbenchAggregate.validate_attention_order` 复制了 service 的精确 sort key，而 integration 已在稳定 observable boundary 锁定顺序，因此删除 validator。不得为“复用 sort key”新增 helper/module。

### Workbench Domain

- `workbenchQueryOptions` 保持唯一导出和唯一 server-state owner，route loader/page 继续共用同一 options/key。
- 单 query key 直接写为 tuple；没有第二 endpoint/namespace 需要 `workbenchKeys` registry。
- 错误路径仍使用本地 generated `ErrorEnvelope` guard 和相同用户可见消息，但返回标准 `Error`；未消费的 status/detail/custom class 不保留。
- `workbenchCountLabels` 继续是同文件 presentation 数据，移除无消费者导出即可。
- 不移动 SectionHeading、loading/content component 或 model maps 到 shared。

### Design System/shared

- 现有 Badge/Button/Skeleton 与 generated API/client 已有真实跨域消费者，保持。
- 不把 Workbench category/labels/permissions/href 放入 shared。
- 不在本 Task 抽取十个 domain 的 ErrorEnvelope guard；只迁移 Workbench 会形成半套模式，全部迁移会超出 Phase 8 范围。

## 3. Security Root-Cause Fix

开发对象存储 URL 的 query 包含 `signature`、`expires`、`operation`。根因不是签名协议，而是测试栈成功 access log 和失败报告回显完整 URL。

最小设计：

1. `deploy/scripts/e2e-local.sh` 对 `app.dev_storage:app` 的 Uvicorn 命令增加原生 `--no-access-log`。不新增 logging config，不影响 backend API/AI fake server 的诊断日志。
2. `geo-real-stack.spec.ts` 的 `requestfailed` 使用标准 `URL` 解析，仅记录 method 与 pathname。
3. 完整 URL 仍在内存中严格比较以证明浏览器 PUT 使用 intent URL，但 matcher 的实际操作数改成 boolean，使失败报告只显示 `true/false`，不显示签名 URL。

不修改 storage signing、upload intent、OpenAPI、数据库、Playwright trace policy或共享 secret scanner。

## 4. Exact Change Map

| 文件 | 设计后状态 | 行为变化 |
| --- | --- | --- |
| `backend/app/schemas/workbench.py` | attention 仅保留 `max_length=10` shape constraint | 无响应行为变化；排序仍由 service 决定 |
| `frontend-v2/src/domains/workbench/workbench.api.ts` | 一个 query options 导出、inline key、普通 Error、local guard | 请求、cache key、retry、message 不变；公开表面缩小 |
| `frontend-v2/src/domains/workbench/workbench.model.ts` | label map 私有 | 无运行时变化 |
| `deploy/scripts/e2e-local.sh` | dev storage 无 access log | 成功 PUT/HEAD/GET 不再打印 capability URL |
| `frontend-v2/tests/e2e/geo-real-stack.spec.ts` | 失败输出无 query；URL equality 不回显 operands | 上传/完整 URL 相等要求不变 |
| `docs/frontend-v2/07-migration-plan.md` | 仅 MET 时记录 Phase 8 完成 | 文档与 Gate 同步 |
| `docs/frontend-v2/08-testing-quality-and-acceptance.md` | 仅 MET 时记录完成并写明实际敏感产物 owners | 去除过强保证 |

## 5. Non-Changes

- 不修改 `backend/app/services/workbench.py`、router、integration fixtures 或 SQL。
- 不修改 Workbench page/route/component tests/strict fixture 或四个 real-stack workflow 的业务步骤。
- 不修改 `docs/frontend-v2/03`、`05`、`09`、OpenAPI、generated types、V1 dashboard 或旧 `frontend/`。
- 不新增 dependency、interface、factory、repository、cache、store、hook、test framework 或 shared component。

## 6. Test Ownership

| Layer | Authoritative responsibility | 本 Task 处理 |
| --- | --- | --- |
| Backend integration | 业务真值、snapshot、tail/null、href/排序、安全字段、固定 SQL | 根 `make test-integration` 重验；不新增重复 case |
| Model/component | presentation、单 query、href passthrough、error/retry/null | 根 `make test-unit` 重验；现有测试覆盖 API 简化 |
| Strict fixture | production build、唯一 GET、unexpected API、keyboard/layout/state matrix | 根 `make e2e` 重验；不改编排 |
| Existing real-stack | 原四域自然 mutation → Workbench projection → canonical navigation | 根 `make e2e` 重验；只修 GEO 输出边界 |
| Root gate | 所有阶段与 Compose config 的固定候选确认 | 独立阶段全绿后唯一一次 `make verify` |

额外最小语法检查只有 `bash -n deploy/scripts/e2e-local.sh`。不机械重跑前三个 Task 的四条定向 real-stack 或同文件定向 suites。

## 7. Documentation Consistency

- `07` 与 `08` 的 Phase 8 完成状态是最终 Gate 的派生结果，不是独立事实源。
- 为保证 `make verify` 检查的就是最终候选：九个独立阶段通过后，写入条件性 `07`/`08` 完成 hunks，再运行唯一一次 `make verify`。
- 若最终 gate 非零，立即用 `apply_patch` 只撤回这两个完成 hunks，在 Task evidence 中记录实际结果为 `NOT_MET`；安全修正与已验证的局部简化不因 gate 失败自动撤销。
- `05`、`09`、OpenAPI/generated types 当前一致，不更新以避免重复设计冻结合同。

## 8. Exit State Model

```text
Planning baseline: NOT_MET (EINF-01 open)
        |
        v
Local candidate: P1 closed, planned P2 closed
        |
        v
9 independent stages all pass? -- no --> NOT_MET + batch attribution
        |
       yes
        v
conditional 07/08 completion + one make verify
        |
        +-- fail --> revert completion hunks, NOT_MET
        |
        +-- pass --> post checks + self-review --> MET
```

三个 retained P2（跨 domain ErrorEnvelope guard、real-stack local glue、exact href coverage）只有在出现统一合同变更、重复维护故障或真实新消费者时才提升；它们不影响本次 `MET`。

## 9. Rollback

- 提交前：使用 `apply_patch` 按文件反向撤销本 Task 的精确 hunks；不得使用 `git checkout --`、`reset --hard` 或历史改写。
- final gate 失败：只撤回 `07`/`08` 的完成声明，保留实际失败证据并判定 `NOT_MET`；不自动回滚已证明正确且能独立保留的安全修正。
- 若某一产品修改被证明错误：反向撤销该文件的本 Task hunk，并运行尚未重复且直接相关的最小检查；不触碰用户或其他 Task 的改动。
- 提交后如获用户授权回滚：对唯一任务提交执行 `git revert <commit>`；不 reset、不 force push。

