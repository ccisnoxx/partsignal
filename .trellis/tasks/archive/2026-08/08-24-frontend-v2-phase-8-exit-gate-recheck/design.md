# Frontend V2 Phase 8 Exit Gate Recheck — 验证设计

## 1. 设计结论

本 Task 不设计生产架构，只定义固定候选上的验证状态机、证据 owner、E2E 隔离和条件性文档收口。复用根 Make targets 与现有 E2E runner，不增加 wrapper、重试器、结果 parser、secret scanner 或第二编排。

```text
冻结 main 产品 SHA + Git/E2E preflight
                  |
                  v
九个独立阶段逐项各一次（非 fail-fast 诊断）
                  |
          all PASS + cleanup + no open P0/P1/P2
                  |
                  v
唯一一次 make verify（最终 fail-fast gate）
                  |
          +-------+-------+
          |               |
        PASS             FAIL
          |               |
  07/08 + Task MET   Task evidence NOT_MET
          |               |
      post-check       no rerun/fix
```

## 2. 固定候选规则

- 产品候选 SHA 固定为 `52da9f45ceb606ed86a7348a4960bf94e63f4c76`，同时写入 Task metadata 与 evidence。
- 批准后创建的唯一临时分支从该 SHA 分出；创建分支不改变候选。
- 当前/父 Task artifacts 和成功路径 `07/08` 是验证证据，不属于产品 source candidate。
- 每个阶段前至少确认 `HEAD` 未变化；在最终 `make verify` 前再次确认 SHA 和 dirty allowlist。
- 任何 backend/frontend/frontend-v2 产品代码、测试、OpenAPI/generated types、数据库合同、Makefile、compose、E2E runner、依赖或环境配置写入都会使现有独立结果不可拼接，立即停止并回到用户决策。

## 3. 独立阶段与失败归因

独立阶段严格串行，避免 npm cache、Docker image、Compose、Redis 和固定端口争用。每个阶段记录 `command / start / end / duration / exit / pass-fail-skip counts / owner / cleanup`。

失败归因只沿实际输出定位到权威 owner：

- 合同：runtime/OpenAPI/generated type drift；
- lint/typecheck：具体 package/file；
- unit：backend/V1/visual/V2 的具体 test file/module；
- integration：backend/PostgreSQL/migration/Compose test container；
- build：backend/V1/V2 artifact；
- E2E：先分 V2 real-stack、V1、V2 fixture，再分业务 spec、浏览器/runtime 与 isolation cleanup；
- Compose：dev/prod 文件、镜像变量或 env 引用。

阶段失败后继续尚未运行且不依赖失败资源的阶段。E2E 出现未知 owner、敏感泄漏、外部资源占用或 cleanup 失败时，不继续任何可能清理/覆盖该资源的命令；静态、合同、build 或 Compose config 等仍安全阶段可继续。没有相关变化时不重复失败命令。

## 4. E2E 环境与 cleanup

### 4.1 运行时环境

1. 只确认 `.env` 存在，不显示内容。
2. 从当前 `.env` 读取本机可达 PostgreSQL/Redis 基础连接到进程环境，不写入 Task、日志摘要或新配置文件。
3. 通过只读运行时选择器查询 Redis 实际 logical DB 数量，从非 0 候选中选择当时为空且无外部客户端的一项；只保留选择出的 DB 编号用于 evidence，不保留 URL。
4. 对选定 URL 调用现有 `deploy/scripts/e2e-environment.py preflight`；只有它确认 DB 非 0、空闲、独占且固定端口可绑定后，才运行 `make e2e`。
5. 最终 `make verify` 内的 E2E 会再次调用同一 preflight；不得把独立 E2E 的成功当作后续环境仍安全的替代。

### 4.2 cleanup 证据

每次真实栈结束必须记录：

| 资源 | 可接受证据 |
| --- | --- |
| PostgreSQL | 本次 allowlist 临时数据库 `status=dropped` |
| Redis | 本次 logical DB 的精确 key 数与 `status=deleted`，最终为空、无外部客户端 |
| Storage | 本次 `mktemp` 目录 `status=removed`，报告不保存完整路径 |
| Processes | runner 对本次 API/storage/AI/worker/scheduler/V1/V2 进程执行 stop + wait；结合端口释放证明无本次 listener |
| Ports | `8000/9001/5173/4173/4174/19009`（或现场显式 storage port）`status=released` |

不得 kill、flush、drop 或删除未知 owner；cleanup 非零使阶段和 Gate 非零。

## 5. 敏感信息保证

- Evidence 只落盘命令名、退出码、计数、耗时、资源状态、脱敏 owner 与最小错误摘要。
- 不落盘连接 URL、password、Cookie、CSRF、Authorization、headers/body、storage state、完整签名 URL、request/response 敏感正文或临时文件路径。
- 不新增 trace/video/report。fixture suite 保持既有策略，real-stack 继续由 config owner 关闭 trace。
- Auth/System 的已知测试密码等 sentinel 由既有 `expectSecretsAbsent` owner 检查。
- 对象存储 capability 由 `e2e-local.sh` 中 dev-storage `--no-access-log` 与 GEO 的 pathname/boolean assertion owner保证；检查结果只说明这些实际边界，不夸大为仓库级全局 scanner。

## 6. Gate 判定算法

```text
candidate_unchanged
AND nine_independent_stages_all_exit_0
AND e2e_cleanup_complete
AND no_sensitive_disclosure
AND A25_closed AND A26_closed
AND current_open_actionable_P0_P1_P2 == 0/0/0
AND make_verify_run_count == 1
AND make_verify_exit == 0
AND post_checks_pass
=> MET

otherwise => NOT_MET
```

归档 A17/A21/A23 继续作为“已接受、非阻断、无 change pressure 的观察项”单列，不把它们改写成已修复，也不与当前开放 defect/blocker 计数混合。A20 在成功路径更新 `08` 后关闭；若 Gate 失败，保持历史记录且不提前改文档。

## 7. 成功路径

1. 最终 `make verify` 退出 `0` 后，判定候选满足产品 Gate。
2. 更新 `07` Phase 8 完成段和 `08` Phase 8 Exit Gate 段，记录实际 SHA、阶段结果/计数、最终耗时、cleanup、A25/A26、open P0/P1/P2=`0/0/0` 与真实敏感 owner。
3. 更新当前 Task evidence/task metadata 与父任务 `current_gate/blocker/current_child` metadata；保留归档首次 `NOT_MET`。
4. 运行 post-check；只允许修正当前 docs/Task artifact 的格式或 metadata 问题，不重跑 `make verify`。
5. 报告成功 commit plan，等待用户确认；不归档父任务、不开始 Phase 9。

## 8. 失败路径

1. 任一独立阶段失败：完成其余安全阶段；最终 gate 标记 `NOT RUN`，Phase 8=`NOT_MET`。
2. 最终 `make verify` 意外失败：记录失败 stage、owner、SHA、耗时和 cleanup；不立即重跑或修复。
3. `07/08` 不标记完成；只更新当前 Task evidence 与父任务 metadata。
4. 不自动创建 blocker Task；等待用户决定是否需要独立 blocker。

## 9. 文档与提交边界

### MET 候选

建议一个提交：`docs(frontend-v2): close phase 8 exit gate`

只含：

- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- 当前 Recheck Task artifacts
- Phase 8 父任务 gate/child metadata

### NOT_MET 候选

建议一个提交：`docs(trellis): record phase 8 exit gate recheck`

只含当前 Recheck Task artifacts与父任务 gate/child metadata；不含 `07/08` 完成声明、产品/测试/合同/config/runner 或归档历史。

两条路径都必须先展示实际 diff 与 commit plan并等待确认；不自动 commit、merge、push、PR、删除分支或 archive。

## 10. 回滚

验证本身不产生产品写入。文档/Task evidence 只用 `apply_patch` 反向撤销当前 Task 精确 hunks；不使用 `git reset --hard`、`git checkout --`、历史改写或广泛删除。E2E 临时资源只由现有 runner 的 allowlist cleanup owner回收。
