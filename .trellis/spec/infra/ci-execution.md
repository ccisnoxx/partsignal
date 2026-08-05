# GitHub Actions 执行契约

## 1. Scope / Trigger

- 本契约适用于 `.github/workflows/ci.yml` 的事件触发配置。
- `push` 只用于同步 GitHub 备份和发布来源；完整 CI 由操作者按需手动执行。

## 2. Signatures

- workflow：`ci`
- event：`workflow_dispatch`
- job：`verify`
- 不涉及 API、数据库或环境变量合同。

## 3. Contracts

- `on` 只声明 `workflow_dispatch`，不得声明 `push` 或 `pull_request`。
- 手动运行必须保留现有 `verify` job 的完整质量检查。
- CI 结果不作为 Hostdzire 发布门禁；发布边界以 `docs/Hostdzire部署上线流程.md` 为准。

## 4. Validation & Error Matrix

| 条件 | 预期结果 |
| --- | --- |
| push 或 PR 更新 | 不创建 `ci` run |
| 手动触发 `workflow_dispatch` | 创建一个完整 `ci` run |
| 手动 CI 失败 | 显式保留失败结果，但不自动部署或阻断既有发布脚本 |
| workflow YAML 无效 | 静态检查失败，禁止提交 |

## 5. Good / Base / Bad Cases

- Good：需要完整反馈时手动运行 `ci`，所有检查通过。
- Base：只 push 备份代码，不产生 Actions 消耗。
- Bad：用 `paths-ignore`、`[skip ci]` 或分支约定模拟手动策略，导致普通 push 仍可能触发。

## 6. Tests Required

- 静态解析 `.github/workflows/ci.yml`，断言只有 `workflow_dispatch`。
- 推送后确认没有自动 run；再手动触发并确认唯一新 run 包含完整 `verify` job。

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
```
