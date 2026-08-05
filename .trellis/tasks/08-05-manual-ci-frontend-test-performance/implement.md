# 收敛手动 CI 与前端测试耗时：实施计划

## 0. 开工门禁

- [x] 当前表格列宽任务完成或明确切换后，再把本任务设为 current 并运行 `task.py start`。
- [x] 用户审批本任务最新 `prd.md`、`design.md`、`implement.md`。
- [x] 运行 `trellis-before-dev`，读取三份任务文档、前端质量/组件规范、共享指南和将修改的完整代码。
- [x] 确认 `main` 工作区没有无法归属的脏改动；保留表格任务交付物，不混入本任务提交。

## 1. 固化基线

- [x] 用 `gh run view 30987954494` 保存最新 runner 失败摘要、测试数、7 个失败文件和 1095.48 秒 wall time。
- [x] 在空闲本地环境分别运行 7 个目标文件、7 文件组合和完整前端门禁，记录 wall time、失败/跳过、慢用例及 CSS 告警数量。
- [x] 逐文件统计完整 `<App />` 与页面级 render 入口；完整读取准备修改的测试和对应页面 Provider/路由依赖。

基线命令：

```bash
cd frontend
/usr/bin/time -p npm exec -- vitest run \
  src/features/configuration/ConfigurationPages.test.tsx \
  src/features/content-editor/ContentEditorPage.test.tsx \
  src/features/content-tasks/ContentTasksPage.test.tsx \
  src/features/geo-observations/GeoObservationsPage.test.tsx \
  src/features/product-facts/ProductsPage.test.tsx \
  src/features/publications/PublicationsPage.test.tsx \
  src/features/users/UserManagementPage.test.tsx
cd ..
/usr/bin/time -p npm --prefix frontend run test
```

## 2. 修改 CI 与文档

- [x] `.github/workflows/ci.yml` 删除 `push` 和 `pull_request`，只保留 `workflow_dispatch`；job 内容保持不动。
- [x] 更新 `docs/Hostdzire部署上线流程.md` 的 GitHub Actions 定位；搜索其他相同表述，只同步真实冲突。
- [x] 静态核对 workflow 仅有手动 trigger，且 YAML 结构未改变 job。

## 3. 最小测试性能修复

- [x] 从仍重复加载完整 `<App />` 且最新 runner 超时的文件开始，每次只迁移不验证认证/壳层的页面业务用例。
- [x] 复用本文件已有 API mock、fixture、QueryClient 和 render helper；没有重复前不建立共享 helper。
- [x] 每完成一个文件，运行该文件并记录迁移前后耗时、测试数和输出；行为断言保持或加强。
- [x] 保留验证完整 App 路由、权限、工作台或焦点合同的集成用例，不把全部测试降为孤立组件测试。
- [x] 不改 `testTimeout`、`maxWorkers`、cleanup、CSS/console 输出和生产组件。

## 4. 必需本地验证

```bash
cd frontend
npm exec -- vitest run \
  src/features/configuration/ConfigurationPages.test.tsx \
  src/features/content-editor/ContentEditorPage.test.tsx \
  src/features/content-tasks/ContentTasksPage.test.tsx \
  src/features/geo-observations/GeoObservationsPage.test.tsx \
  src/features/product-facts/ProductsPage.test.tsx \
  src/features/publications/PublicationsPage.test.tsx \
  src/features/users/UserManagementPage.test.tsx
cd ..
npm --prefix frontend run test
npm --prefix frontend run test
npm --prefix frontend run lint
npm --prefix frontend run typecheck
git diff --check
```

如迁移改变了完整 App 覆盖边界，再运行对应现有 Playwright 用例；不因测试 harness 调整机械执行完整 E2E。

## 5. 手动 GitHub 验证与分片门槛

- [ ] 按项目规则展示提交计划并取得确认后提交到 `main`；不自动推送。
- [ ] 用户明确授权推送后推送；随后手动触发 `ci`，确认 push 本身没有自动 run，手动入口产生唯一新 run。
- [ ] 手动 run 前端 Vitest 零超时且不超过 10 分钟时，保持单 job 并结束。
- [ ] 只有本地两次通过但 runner 仍不达标时，按设计拆出原生 2 shard、每 shard 1 worker；重新运行静态检查、本地相关命令和手动 CI。

## 6. 完成检查

- [x] diff 没有自动部署、服务器 `git pull`、新凭据、测试跳过、断言弱化、超时放宽、新依赖或第二套测试框架。
- [x] 更新任务报告，记录触发验证、本地前后耗时、手动 runner 结果、是否启用分片及残余风险。
- [x] 运行 `trellis-check`；只有形成新的稳定项目约定时才使用 `trellis-update-spec`，否则说明现有规范已覆盖。
- [x] 说明测试代码中的中文注释/JSDoc/开发者可见文本是否更新；workflow 纯配置不增加机械注释。
