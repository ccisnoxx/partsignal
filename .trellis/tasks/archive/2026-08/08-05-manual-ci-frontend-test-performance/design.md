# 收敛手动 CI 与前端测试耗时：技术设计

## 1. 设计结论

CI 触发和 CI 内容分开处理：只删除 `.github/workflows/ci.yml` 的 `push`、`pull_request` 触发器，现有 `verify` job 保持不变。GitHub 继续保存代码并提供手动质量检查，发布继续使用现有本地归档上传脚本。

前端测试只减少与断言无关的装配成本。页面业务测试加载页面自身及所需 Provider，完整应用路由、权限与工作台集成由现有少量集成测试和 Playwright E2E 持有。不改生产组件，不新增依赖。

## 2. CI 触发边界

目标配置只有一个入口：

```yaml
on:
  workflow_dispatch:
```

不使用 `paths-ignore`：它只能避免 journal 等特定路径，普通代码备份仍会触发。也不使用 `[skip ci]`：行为依赖每次提交者记忆，不能表达仓库稳定策略。删除 workflow 会失去按需完整验证，因此保留手动入口。

## 3. 测试性能边界

### 3.1 基线与定位

在当前任务开始时记录：

1. 最新失败的 7 个文件单独运行耗时；
2. 7 文件组合在当前 `maxWorkers: 2` 下的 wall time；
3. 完整 `npm --prefix frontend run test` 的测试数、失败/跳过数和 wall time；
4. 各文件中完整 `<App />` 渲染次数与页面级 render 入口。

不再试验归档任务已经排除的 CSS 开关、cleanup 顺序、`getComputedStyle` 包装和 Node 主版本。

### 3.2 页面级 harness

- 先复用同文件已有 `renderWithQuery`、API mock、fixture 和 QueryClient；没有现成入口时只加入当前页面所需的最小本地 render 函数。
- 完整 `<App />` 只保留给确实验证认证、管理员路由、pathname 跳转或工作台布局的测试。
- 表单提交、请求载荷、错误反馈、删除确认、焦点恢复等页面行为直接渲染当前页面及必要 Provider。
- 不用 mock 成功替代真实组件流程，不把异步断言换成固定等待，不删除对服务端请求形状和路由结果的验证。

共享 test render 不是默认交付物。只有实施中确认至少三个文件使用完全相同的 Provider 组合、清理和 query owner，且本地 helper 会真实重复时，才放入 `frontend/src/test/`；否则各 feature 持有自己的 harness。

### 3.3 分片门槛

默认保持单个 `verify` job，避免先重构整个 workflow。完成 harness 优化并推送后手动运行一次 CI：

- Vitest 无超时且不超过 10 分钟：不分片。
- 本地连续两次达标，但 runner 仍超时或超过 10 分钟：把前端 Vitest 单独拆成原生 2 shard、每 shard 1 worker；其他检查不复制执行。

如果进入分片，需要把 `make test-unit` 中后端 pytest 与前端 npm test 拆到对应 job 的现有原生命令，保持同一测试集合；不新增 Make target 或脚本，除非现有 workflow 无法清晰表达且再次评审。

## 4. 文档一致性

更新 `docs/Hostdzire部署上线流程.md` 中 GitHub Actions 的描述：push 只同步发布来源，Actions 仅手动按需运行；快速/完整发布仍不读取 Actions 状态或产物。其他部署附录只有出现同样的“自动异步反馈”表述时才同步修改。

## 5. 风险与回滚

- 手动 CI 可能被忘记：这是用户明确选择的备份优先策略；Runbook 明确按需入口，不增加自动提醒系统。
- 页面级 harness 可能漏掉 Provider 合同：每个迁移测试先列出实际依赖，完整 App 集成和 E2E 保留；定向与完整门禁都必须通过。
- runner 性能存在波动：使用同环境前后对比，并以手动 GitHub run 最终验证；不把单次本地快运行当成 runner 已修复。
- 2 路分片增加 runner 总分钟：只在单 job 经最小测试修复后仍不达标时启用。

全部变更可按文件回退，不涉及数据迁移、API、服务器凭据或运行中服务。
