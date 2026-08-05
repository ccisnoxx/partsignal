# 收敛手动 CI 与前端测试耗时：实施报告

## 已完成变更

- `.github/workflows/ci.yml` 仅保留 `workflow_dispatch`；现有 `verify` job 内容未改。
- Hostdzire Runbook 明确：push 只同步备份和发布来源，手动 CI 提供完整质量反馈但不是发布门禁。
- 内容审核、发布工作台、用户管理三组页面业务测试改为本文件内的最小页面级 harness；未修改生产代码、断言、测试超时、worker、cleanup 或告警处理。
- 新增 GitHub Actions 执行规范，固化手动触发与发布边界。

## 性能证据

所有本地结果均在同一工作目录、同一依赖和 `maxWorkers: 2` 下使用 `/usr/bin/time -p` 记录。

| 范围 | 旧版 wall time | 改后 wall time | 结果 |
| --- | ---: | ---: | --- |
| 3 个迁移文件组合（35 tests） | 78.06s | 49.32s | -36.8%，全部通过 |
| `ContentEditorPage.test.tsx`（12 tests） | 56.92s | 29.24s | -48.6%，全部通过 |
| `PublicationsPage.test.tsx`（13 tests） | 40.56s | 26.43s | -34.8%，全部通过 |
| `UserManagementPage.test.tsx`（10 tests） | 35.47s | 23.37s | -34.1%，全部通过 |
| 7 个历史慢文件（105 tests） | 198.08s | 168.54s | -14.9%，全部通过 |
| 完整前端门禁（190 + 24 tests） | 247.14s | 218.83s / 218.93s | 连续两次全部通过 |

最新 GitHub run `30987954494` 的旧版 Vitest 为 1095.48 秒并有 13 个 30 秒超时；本地优化后两轮完整 Vitest 均无 30 秒超时。页面级改造文件逐项超过 20% 改善，因此没有扩大改动面或启用分片。

## 已运行验证

- 7 个历史慢文件：7 files、105 tests，零失败、零跳过、无超时。
- 完整 `npm --prefix frontend run test` 连续两次：27 files、190 Vitest tests 和 24 visual-contract tests 全部通过，wall time 218.83s / 218.93s。
- `npm --prefix frontend run lint`：通过。
- `npm --prefix frontend run typecheck`：通过。
- workflow YAML 解析和 trigger 搜索：通过，只发现 `workflow_dispatch`。
- `git diff --check`：通过。

## 待远端验证

- 当前未提交、未推送，符合项目禁止自动提交和推送的规则。
- 取得用户提交与推送授权后，需确认 push 没有创建自动 `ci` run，再手动触发唯一新 run。
- 手动 run 需确认 Vitest 零超时且不超过 10 分钟；只有届时仍不达标才按设计启用 Vitest 原生 2 路 shard。
