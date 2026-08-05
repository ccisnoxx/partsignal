# GitHub Actions 执行契约

## 1. Scope / Trigger

- 本契约适用于 `.github/workflows/ci.yml` 的事件触发配置。
- `push` 只用于同步 GitHub 备份和发布来源；完整 CI 由操作者按需手动执行。

## 2. Signatures

- workflow：`ci`
- event：`workflow_dispatch`
- jobs：`verify`、`frontend-test`；`frontend-test` 使用 `shard: [1, 2]` 矩阵。
- 前端分片命令：在 `frontend/` 工作目录运行 `npm exec -- vitest run --shard=<1|2>/2 --maxWorkers=1`。
- 不涉及 API、数据库或环境变量合同。

## 3. Contracts

- `on` 只声明 `workflow_dispatch`，不得声明 `push` 或 `pull_request`。
- 手动运行必须保留完整质量检查：`verify` 持有合同、lint、typecheck、后端单元/集成、视觉契约、构建、E2E 和 Compose 检查；`frontend-test` 持有两路完整 Vitest 集合。
- 两个 shard 各使用 1 个 worker，测试文件集合并集必须等于本地权威 `npm --prefix frontend run test` 中的 Vitest 集合；不得修改超时、断言或跳过规则换取通过。
- `test` 是 `vitest run && npm run test:visual-contract` 复合脚本，分片参数必须直接传给 Vitest；不得使用 `npm run test -- --shard=...`，否则参数只会追加到末尾的视觉契约命令。
- CI 结果不作为 Hostdzire 发布门禁；发布边界以 `docs/Hostdzire部署上线流程.md` 为准。

## 4. Validation & Error Matrix

| 条件 | 预期结果 |
| --- | --- |
| push 或 PR 更新 | 不创建 `ci` run |
| 手动触发 `workflow_dispatch` | 创建一个完整 `ci` run |
| 单 job Vitest 超过 10 分钟或出现 runner 超时 | 使用原生 2 路 shard，每路 1 worker |
| 任一 shard 超时、失败或两片未覆盖完整测试集合 | 手动 CI 失败并保留可核对日志 |
| 手动 CI 失败 | 显式保留失败结果，但不自动部署或阻断既有发布脚本 |
| workflow YAML 无效 | 静态检查失败，禁止提交 |

## 5. Good / Base / Bad Cases

- Good：需要完整反馈时手动运行 `ci`，`verify` 与两路 `frontend-test` 全部通过。
- Base：只 push 备份代码，不产生 Actions 消耗。
- Bad：用 `paths-ignore`、`[skip ci]` 或分支约定模拟手动策略；或在同一两核 runner 增加 worker、放宽超时来隐藏性能问题。

## 6. Tests Required

- 静态解析 `.github/workflows/ci.yml`，断言只有 `workflow_dispatch`。
- 推送后确认没有自动 run；再手动触发并确认唯一新 run 包含 `verify` 和两路 `frontend-test`。
- 两路 Vitest 均需零失败、零跳过、零超时且各自不超过 10 分钟；两片文件数和测试数之和必须等于未分片全集。

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

# Wrong：复合 npm script 会把分片参数传给末尾命令。
- run: npm --prefix frontend run test -- --shard=1/2 --maxWorkers=1

# Correct：在前端工作目录直接调用 Vitest。
- run: npm exec -- vitest run --shard=${{ matrix.shard }}/2 --maxWorkers=1
  working-directory: frontend
```
