# Implement — Frontend V2 Phase 4 Exit Gate Environment Corrected

> 当前状态：门禁与 cleanup 已完成，Gate=`MET`；等待用户确认 commit plan。任务保持在 `main`，未修改代码或测试。

## Phase 0 — Freeze and activation

- [x] 前一 Task 已提交、快进合并、归档并记录 journal；旧本地分支已删除。
- [x] 冻结干净 `main` 候选 `b5c5919d96f53d6b3feff4e21f97f87c9a9fc42e`。
- [x] 创建当前 Task 的 `prd.md` / `implement.md`，不创建空 `design.md`。
- [x] 运行 `task.py start`，保持在 `main`。

## Phase 1 — Build the two-variable environment

在每个 preflight/gate shell 内使用项目已安装的 `python-dotenv` 只读取两个值：

```zsh
source_database_url=$(backend/.venv/bin/python -c \
  'from dotenv import dotenv_values; print(dotenv_values(".env")["DATABASE_URL"])')
source_redis_url=$(backend/.venv/bin/python -c \
  'from dotenv import dotenv_values; print(dotenv_values(".env")["REDIS_URL"])')
```

使用 `urllib.parse` 仅替换宿主机端口，得到 PostgreSQL `127.0.0.1:55432` 与 Redis DB 15 `127.0.0.1:56379/15`。随后枚举 `.env` 键并逐个 `unset` 除两个 URL 外的键，最后只执行：

```zsh
export DATABASE_URL REDIS_URL
```

禁止 `set -a`；禁止输出完整 URL 或凭据。保存环境键交集名称，必须精确为两个 URL。

- [x] 使用 `dotenv_values()` 构造宿主机 PostgreSQL 与 Redis DB 15 URL。
- [x] 显式清除其余 `.env` 键，只导出 `DATABASE_URL`、`REDIS_URL`。
- [x] 证据只记录键名与非敏感连接结果，未记录 URL 或凭据。

## Phase 2 — Required preflight

- 确认当前分支 `main`、`HEAD=b5c5919...`、工作区只有当前 Task。
- 只读确认 PostgreSQL source 可访问且可建库。
- 只读确认 Redis DB 15 的 `DBSIZE/queue/unacked/unacked_index/binding/external clients` 全为 0。
- 确认六端口无 listener。
- 保存到 `evidence/preflight.txt`；失败不运行门禁。

结果：`2026-08-12 16:16:51 +0800` 全部通过；候选为 `b5c5919d96f53d6b3feff4e21f97f87c9a9fc42e`，工作区 allowlist、PostgreSQL 建库能力、Redis DB 15 空且独占、六端口无 listener、环境键精确 allowlist 均已留证。

## Phase 3 — Single authoritative gate

唯一运行：

```bash
make verify
```

保存：

- `evidence/make-verify.log`
- `evidence/make-verify.exit-code`
- `evidence/make-verify.started-at`
- `evidence/make-verify.finished-at`

从同一日志记录 contract/generated checks、Ruff/mypy、backend unit/integration、V1/V2 lint/typecheck/unit、三套 build、V2 real-stack、V1 E2E、V2 fixture、Compose dev/prod config，以及 Publishing Flow A/B、Article readonly、Issue/repair lifecycle。不运行独立完整 `make e2e`。

执行结果：

- [x] 只执行一次 `make verify`；`2026-08-12 16:17:15 +0800` 至 `16:32:47 +0800`，退出码 `0`。
- [x] contract-check、V1/V2 generated API check、Ruff、mypy、V1/V2 lint/typecheck 全部通过。
- [x] backend unit `181 passed`；V1 unit `203 passed` + visual contract `24 passed`；V2 unit `282 passed`；backend integration `93 passed`。
- [x] backend、V1、V2 production build 全部通过；仅保留既有 V2 chunk-size warning，不影响退出码或合同。
- [x] V2 real-stack `10 passed`；V1 E2E `52 passed`；V2 fixture E2E `209 passed / 21 skipped`。
- [x] Publishing Flow A/B、Article readonly、Issue/repair lifecycle 与 Content/Product 不可变历史真实栈断言通过。
- [x] Compose dev/prod config 通过；未单独运行完整 `make e2e`。

## Phase 4 — Cleanup

- 核对精确 E2E 数据库与临时存储 `status=deleted` 并确认实际不存在。
- 确认本次 API/Worker/Scheduler/fake AI/storage/V1/V2 进程和六端口退出。
- 确认 Redis queue/unacked 为空、logical DB 独占；逐个删除枚举出的精确 binding 键，最终 `DBSIZE=0`。
- 保存 `evidence/cleanup-check.txt`；cleanup 失败时 Gate=`NOT_MET`。

结果：

- [x] E2E 数据库 `partsignal_e2e_20260812_66472` 和临时对象存储实际不存在。
- [x] `8000/9001/5173/4173/4174/19009` 无 listener，本次服务进程已退出。
- [x] Redis DB 15 无外部客户端、queue/unacked/other keys；精确删除 `_kombu.binding.celery` 与 `_kombu.binding.generation-reliability-a5f0df3cc4564370b948209f4fc39a13`，最终 `DBSIZE=0`。
- [x] 未使用通配删除或 `FLUSHDB`；cleanup 状态为 `passed`。

## Phase 5 — Decision and documentation

- 按六类逐项记录证据，使用既定公式判定 `MET` / `NOT_MET`。
- 成功时只更新 `docs/frontend-v2/07-migration-plan.md` 与当前 Task；`08/09` 无事实变化则不动。
- 失败时停止并记录分类，不修复、不重跑。
- 运行 `trellis-check`、Task validation 与 diff 自审；未经新确认不提交、push、归档或进入 GEO。

最终判定：

- [x] Product=`MET`
- [x] Engineering=`MET`
- [x] UX=`MET`
- [x] Architecture=`MET`
- [x] Contract=`MET`
- [x] Documentation=`MET`
- [x] unresolved P0/P1/P2 findings=`0`
- [x] `docs/frontend-v2/07-migration-plan.md` 只追加最终 MET；`08/09` 已一致，保持不动。
- [x] 完成 `trellis-check`、Task validation 与 diff 自审。

结论：唯一门禁退出码为 `0`，六类全为 `MET`，fixture、real-stack、cleanup 全部通过，代码、合同、生成类型与文档无漂移，因此 **Frontend V2 Phase 4 Gate = MET**。不进入 GEO。

自审结果：Trellis Task validation 通过；9 个 Task 文件、唯一门禁标记、退出码与关键数量断言通过；证据未发现数据库凭据或被禁止的开发变量；`git diff --check` 通过。diff 范围精确为当前 Task 与 `docs/frontend-v2/07-migration-plan.md`，`08-testing-quality-and-acceptance.md` 和 `09-architecture-decisions.md` 的 Publishing 合同与本次结果一致，无需修改；没有可执行代码变更，因此无需新增或更新 `.trellis/spec/`。

## Expected changed files

- 当前 Task 的 `task.json`、`prd.md`、`implement.md`
- 当前 Task 的 `evidence/preflight.txt`、门禁日志/退出码/起止时间、`cleanup-check.txt`
- `docs/frontend-v2/07-migration-plan.md`（仅 Gate=`MET`）

明确不改：`design.md`、`08/09`、生产代码、测试、合同、配置、部署脚本、生成类型与 GEO。
