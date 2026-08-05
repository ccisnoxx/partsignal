# 收敛手动 CI 与前端测试耗时：实施报告

## 已完成变更

- `.github/workflows/ci.yml` 仅保留 `workflow_dispatch`；远端单 job 验证不达标后，按预设门槛把前端 Vitest 拆为原生 2 路 shard、每路 1 worker。主 `verify` job 继续执行后端单测和一次视觉契约测试，不复制其他检查。
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

旧 GitHub run `30987954494` 的 Vitest 为 1095.48 秒并有 13 个 30 秒超时；本地优化后两轮完整 Vitest 均无 30 秒超时。推送后的手动 run `30999781929` 再次证明单 job runner 不达标：Vitest 运行 958.88 秒，27 文件中 23 个通过、4 个失败，190 个测试中 184 个通过、6 个因 30 秒超时失败。因此按设计启用原生 2 路分片，没有提高超时或修改业务断言。

## 已运行验证

- 7 个历史慢文件：7 files、105 tests，零失败、零跳过、无超时。
- 完整 `npm --prefix frontend run test` 连续两次：27 files、190 Vitest tests 和 24 visual-contract tests 全部通过，wall time 218.83s / 218.93s。
- `npm --prefix frontend run lint`：通过。
- `npm --prefix frontend run typecheck`：通过。
- workflow YAML 解析和 trigger 搜索：通过，只发现 `workflow_dispatch`。
- 本地分片复核：shard 1 为 14 files、81 tests，177.94s；shard 2 为 13 files、109 tests，263.57s；两片合计 27 files、190 tests，全部通过。
- 独立视觉契约：24 tests，全部通过。
- `git diff --check`：通过。

## 待远端验证

- 手动 CI 配置已随 `e806cdb` 推送；该 push 未产生自动 run，手动入口正常创建 run `30999781929`。
- 2 路分片调整和本报告更新尚未提交、推送。取得用户确认后提交并推送，再手动触发一次 CI，确认两路 Vitest 均零超时且各自不超过 10 分钟。
