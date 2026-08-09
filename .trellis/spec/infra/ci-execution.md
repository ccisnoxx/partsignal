# GitHub Actions 执行契约

## 1. Scope / Trigger

- 本契约适用于 `.github/workflows/ci.yml` 的事件触发配置。
- `push` 只用于同步 GitHub 备份和发布来源；完整 CI 由操作者按需手动执行。

## 2. Signatures

- workflow：`ci`
- event：`workflow_dispatch`
- jobs：`verify`、`frontend-test`；`frontend-test` 使用 `shard: [1, 2]` 矩阵。
- `verify` 的 npm cache 输入：`frontend/package-lock.json`、`frontend-v2/package-lock.json`。
- `verify` 顺序安装：`npm ci --prefix frontend`、`npm ci --prefix frontend-v2`。
- V2 单元测试：`npm --prefix frontend-v2 run test`；根 E2E：`make e2e`。
- 前端分片命令：在 `frontend/` 工作目录运行 `npm exec -- vitest run --shard=<1|2>/2 --maxWorkers=1`。
- 不涉及 API、数据库或环境变量合同。

## 3. Contracts

- `on` 只声明 `workflow_dispatch`，不得声明 `push` 或 `pull_request`。
- 手动运行必须保留完整质量检查：`verify` 持有 V1/V2 合同、lint、typecheck、后端单元/集成、V1 视觉契约、V2 unit、V1/V2 构建、V1 真实 E2E、V2 Foundation smoke 和 Compose 检查；`frontend-test` 持有两路完整 V1 Vitest 集合。
- `verify` 必须缓存并安装两份 lockfile；任一安装或 V2 检查失败时 job 失败，不得静默跳过。
- 两个 shard 各使用 1 个 worker，测试文件集合并集必须等于本地权威 `npm --prefix frontend run test` 中的 Vitest 集合；不得修改超时、断言或跳过规则换取通过。
- `test` 是 `vitest run && npm run test:visual-contract` 复合脚本，分片参数必须直接传给 Vitest；不得使用 `npm run test -- --shard=...`，否则参数只会追加到末尾的视觉契约命令。
- 手动 CI 是低频备用质量反馈，不是日常 push 或部署步骤；runner 耗时只记录为运维证据，不自动扩大 shard 数量。
- CI 结果不作为 Hostdzire 发布门禁；发布边界以 `docs/Hostdzire部署上线流程.md` 为准。

## 4. Validation & Error Matrix

| 条件 | 预期结果 |
| --- | --- |
| push 或 PR 更新 | 不创建 `ci` run |
| 手动触发 `workflow_dispatch` | 创建一个完整 `ci` run |
| V1/V2 任一依赖安装、质量检查、build 或 E2E 失败 | `verify` job 与 workflow 失败 |
| 单 job Vitest 超过 10 分钟或出现 runner 超时 | 使用原生 2 路 shard，每路 1 worker |
| 任一 shard 超时、失败或两片未覆盖完整测试集合 | 手动 CI 失败并保留可核对日志 |
| 手动 CI 失败 | 显式保留失败结果，但不自动部署或阻断既有发布脚本 |
| workflow YAML 无效 | 静态检查失败，禁止提交 |

## 5. Good / Base / Bad Cases

- Good：需要完整反馈时手动运行 `ci`，`verify` 覆盖 V1/V2，且两路 V1 `frontend-test` 全部通过。
- Base：只 push 备份代码，不产生 Actions 消耗。
- Bad：只缓存/安装一份前端 lockfile、删除 V1 shard、给 V2 提前分片，或用 `paths-ignore`、额外 worker、放宽超时隐藏问题。

## 6. Tests Required

- 静态解析 `.github/workflows/ci.yml`，断言只有 `workflow_dispatch`。
- 静态断言 `verify` cache/install 同时包含 `frontend` 与 `frontend-v2`，并保留 V1 两路 shard。
- 本地运行 V2 unit、根 build/E2E 与最终 `make verify`；无 push 授权时不声称远端 workflow 已运行。
- 推送后确认没有自动 run；再手动触发并确认唯一新 run 包含 `verify` 和两路 `frontend-test`。
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

# Wrong：verify 只缓存 V1 lockfile，V2 npm ci 无缓存合同。
cache-dependency-path: frontend/package-lock.json

# Correct：verify 同时以两份 lockfile 作为缓存输入。
cache-dependency-path: |
  frontend/package-lock.json
  frontend-v2/package-lock.json

# Wrong：复合 npm script 会把分片参数传给末尾命令。
- run: npm --prefix frontend run test -- --shard=1/2 --maxWorkers=1

# Correct：在前端工作目录直接调用 Vitest。
- run: npm exec -- vitest run --shard=${{ matrix.shard }}/2 --maxWorkers=1
  working-directory: frontend
```
