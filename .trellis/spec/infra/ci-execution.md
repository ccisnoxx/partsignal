# GitHub Actions 执行契约

## 1. Scope / Trigger

- 本契约适用于 `.github/workflows/ci.yml` 的事件触发配置。
- `push` 只用于同步 GitHub 备份和发布来源；完整 CI 由操作者按需手动执行。

## 2. Signatures

- workflow：`ci`
- event：`workflow_dispatch`
- jobs：`verify`、`frontend-test`；`frontend-test` 使用 `shard: [1, 2]` 矩阵。
- npm cache 唯一输入：`frontend/package-lock.json`。
- 前端依赖只安装：`npm ci --prefix frontend`。
- canonical 前端单元测试：`npm --prefix frontend run test`；根 E2E：`make e2e`。
- 前端分片命令：在 `frontend/` 工作目录运行 `npm exec -- vitest run --shard=<1|2>/2 --maxWorkers=1`。
- E2E step 覆盖 `REDIS_URL=redis://localhost:6379/14`；backend integration 继续继承 job 级 DB 15。

## 3. Contracts

- `on` 只声明 `workflow_dispatch`，不得声明 `push` 或 `pull_request`。
- 手动运行必须保留完整质量检查：`verify` 持有合同、lint、typecheck、后端单元/集成、canonical 前端 unit/build/container/E2E 和 Compose/部署脚本检查；`frontend-test` 持有两路 canonical Vitest 集合。
- `verify` 只缓存并安装 canonical `frontend/`；依赖安装或任一检查失败时 job 失败，不得静默跳过或恢复第二套前端。
- `make e2e` 必须覆盖 step 级 Redis DB 14，避免清理前序 backend integration 所属的 DB 15；不得退回 DB 0 或共享 logical DB。
- 两个 shard 各使用 1 个 worker，测试文件集合并集必须等于本地权威 `npm --prefix frontend run test` 中的 Vitest 集合；不得修改超时、断言或跳过规则换取通过。
- 手动 CI 是低频备用质量反馈，不是日常 push 或部署步骤；runner 耗时只记录为运维证据，不自动扩大 shard 数量。
- CI 结果不作为 Hostdzire 发布门禁；发布边界以 `docs/Hostdzire部署上线流程.md` 为准。

## 4. Validation & Error Matrix

| 条件 | 预期结果 |
| --- | --- |
| push 或 PR 更新 | 不创建 `ci` run |
| 手动触发 `workflow_dispatch` | 创建一个完整 `ci` run |
| canonical 前端依赖安装、质量检查、build 或 E2E 失败 | `verify` job 与 workflow 失败 |
| `make e2e` 未覆盖 Redis DB 14 或仍使用 backend integration 的 DB 15 | 静态检查失败，禁止运行会清理共享 DB 的 E2E |
| 单 job Vitest 超过 10 分钟或出现 runner 超时 | 使用原生 2 路 shard，每路 1 worker |
| 任一 shard 超时、失败或两片未覆盖完整测试集合 | 手动 CI 失败并保留可核对日志 |
| 手动 CI 失败 | 显式保留失败结果，但不自动部署或阻断既有发布脚本 |
| workflow YAML 无效 | 静态检查失败，禁止提交 |

## 5. Good / Base / Bad Cases

- Good：需要完整反馈时手动运行 `ci`，`verify` 覆盖唯一 canonical 前端，且两路 `frontend-test` 全部通过。
- Base：只 push 备份代码，不产生 Actions 消耗。
- Bad：缓存或安装已退役路径、恢复 V1 visual contract、使用 `paths-ignore`、额外 worker 或放宽超时隐藏问题。

## 6. Tests Required

- 静态解析 `.github/workflows/ci.yml`，断言只有 `workflow_dispatch`。
- 静态断言 `verify` cache/install 只包含 `frontend`，且两路 canonical shard 都保留。
- 静态断言 `make e2e` step 覆盖 `REDIS_URL=redis://localhost:6379/14`，job 级 backend integration 保持 DB 15。
- 本地运行 canonical frontend unit、根 build/E2E 与最终 `make verify`；无 push 授权时不声称远端 workflow 已运行。
- 推送后确认没有自动 run；再由操作者手动触发并确认唯一新 run 包含 `verify` 和两路 `frontend-test`。
- 两路 Vitest 需记录失败、跳过、超时和实际耗时；两片文件数和测试数之和必须等于未分片全集。runner 偏慢作为已知残余风险，不通过增加 shard、worker 或放宽超时自动修复。

## 7. Wrong vs Correct

```yaml
# Wrong：push 和 PR 都会自动运行。
on:
  workflow_dispatch:
  push:
  pull_request:

# Correct：只允许操作者手动运行。
on:
  workflow_dispatch:

# Wrong：缓存已退役路径或两份 lockfile。
cache-dependency-path: |
  frontend/package-lock.json
  frontend-v2/package-lock.json

# Correct：canonical frontend 是唯一依赖 owner。
cache-dependency-path: frontend/package-lock.json

# Correct：在前端工作目录直接调用 Vitest。
- run: npm exec -- vitest run --shard=${{ matrix.shard }}/2 --maxWorkers=1
  working-directory: frontend
```
