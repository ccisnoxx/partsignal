# 验收门禁恢复

## Goal

修复全项目验收中确认的测试夹具、测试预期、运行壳层、视觉基线和数据清理问题，使集成测试、24 表、Trusted Types、Prompt 删除与主要 E2E 能准确区分产品缺陷和测试缺陷，为后续产品修复与发布回归提供可信证据。

## Background

父任务 `07-31-sitewide-table-actions-delete-testing` 的本轮结果为：

- `make test-integration`：`59 passed / 9 failed`。7 个失败来自 Prompt 旧字段夹具，2 个来自迁移模型/head 断言漂移。
- `make e2e`：`39 passed / 13 failed`。其中打印与 200% zoom 属于产品缺陷，其余主要是测试、视觉基线、文档或测试壳层漂移。
- 24 表 E2E 在“登记人工观测”Modal 未关闭后超时。
- Trusted Types 测试把生产 CSP 注入 Vite dev HTML，阻止 React preamble，三浏览器均未挂载应用。
- Prompt 删除 E2E 仍调用已移除的 `/api/v1/platform-profiles/{id}/prompt`。
- 开发数据库积累了大量 E2E 用户、内容任务和文件清理重试记录。

权威证据见父任务：

- `research/findings.md` 中 `PS-QA-101` 至 `PS-QA-108`、`PS-QA-D01`。
- `research/coverage-matrix.md`。
- `research/table-action-delete-matrix.md`。

## Requirements

### R1. 恢复后端集成门禁

1. 生成可靠性夹具必须使用当前可复用 `platform_prompts` 模型，并由 `platform_profiles.platform_prompt_id` 建立绑定。
2. 迁移测试必须分别验证目标迁移和当前 `head`，不得把 `upgrade head` 固定断言为旧版本。
3. 不通过降低断言、跳过用例、固定成功返回或新增兼容旧字段来消除失败。
4. `make test-integration` 必须真实执行 PostgreSQL、Redis、Worker/HTTP 边界并通过。

### R2. 恢复 24 表运行时门禁

1. 特殊表面必须等待 Modal 实际关闭后再导航，不能只发送 Escape 后立即继续。
2. 24 项源码清单与桌面、移动运行时检查必须全部完成，失败需定位到具体表面。
3. 测试不得依赖隐藏元素、被遮挡的后台表格或无限重试。
4. 保留真实 200% zoom 的产品缺陷断言；本任务不修改其产品实现。

### R3. 恢复 Trusted Types/CSP 门禁

1. 生产 CSP 必须在不依赖 Vite React 内联 preamble 的壳层中验证。
2. 测试需继续证明命名策略、Ant 交互、Markdown 清洗、CSP violation 和运行时错误。
3. Chromium、Firefox、WebKit 使用同一权威 Nginx CSP。
4. 不允许通过 `bypassCSP`、删除 `require-trusted-types-for 'script'` 或给生产 CSP 增加仅测试需要的放宽项来通过。

### R4. 同步当前合同与批准行为

1. Prompt 删除测试必须使用 OpenAPI 当前路径 `/api/v1/platform-prompts/{platform_prompt_id}`。
2. 工程师直达管理员页的 E2E 必须与已存在的 `AdminRoute` 组件合同一致：保留 URL 并显示可访问的 403 提示。
3. 可复用 Prompt 页面视觉基线必须更新为当前批准页面，不能改页面去匹配旧基线。
4. GEO 洞察正式采用 3 项指标：发现率、提及率、准确率。OpenAPI 和当前页面保持不变，测试与产品设计文档必须同步为这 3 项。
5. `docs/GEO多平台内容运营系统方案设计.md` 中把推荐率、引用率作为当前洞察趋势、排行和运营验收指标的旧描述必须改为现行 3 项口径；推荐/引用原始观测事实与 `legacy_*` 只读历史字段仍按当前合同保留，不得误删。
6. 内容排行同步当前服务端规则：表现最佳依次按准确率、提及率、发现率、观测次数排序；表现下降基于准确率、提及率、发现率任一项下降至少 10 个百分点。

### R5. 测试数据所有权与清理

1. 每次 E2E run 的可删除对象使用可追踪前缀或显式 ID 集合。
2. teardown 仅清理本次 run 拥有的对象；不得广泛删除开发环境中来源不明的数据。
3. 受保护历史、审计和不可物理删除对象必须记录为保留项，不得把清理失败静默忽略。
4. 文件删除失败必须给出对象 ID、重试状态和最终结果，不能只打印泛化警告。
5. 成功执行后，普通可删除测试用户、配置与临时文件不应继续累积。

## Acceptance Criteria

- [ ] `make test-integration` 全部通过，原 9 个失败不再出现。
- [ ] 生成可靠性测试仍覆盖真实 HTTP、Worker 丢失、迟到结果、重试与幂等边界。
- [ ] 24 表 E2E 在 1440×1000 和 375×900 完成全部登记表面，不再因 Modal 遮挡或超时退出。
- [ ] Trusted Types/CSP 用例在 Chromium、Firefox、WebKit 中挂载真实应用并完成全部安全断言。
- [ ] Prompt DELETE 用例只调用当前 OpenAPI 路径，并验证真实 403/404 结构。
- [ ] 管理员路由和 Prompt 视觉基线不再产生已知假失败。
- [ ] GEO 洞察趋势、平台表现、内容排行和运营验收文档统一使用发现率、提及率、准确率 3 项正式指标。
- [ ] 设计文档不再把推荐率、引用率描述为当前洞察趋势或排行依据，但仍准确保留原始观测事实和 `legacy_*` 历史指标边界。
- [ ] 一次成功 E2E 执行后，本轮普通测试对象已清理；受保护保留项有明确清单。
- [ ] `make lint`、`make typecheck` 和相关测试配置检查通过。
- [ ] 未修改产品业务行为；父任务确认的打印、200% zoom 和取消按钮缺陷仍由独立修复任务负责。

## Out of Scope

- 修复 GEO 打印宽度、内容任务 200% zoom 越界或取消任务弹窗。
- 改变业务状态机、权限、数据库删除规则或 OpenAPI 业务字段。
- 给全部列表新增 `available_actions`。
- 补齐 13 个 DELETE 的完整新功能回归矩阵；本任务只恢复已经失效或被阻断的门禁。
- 清理无法确认所有权的历史开发数据。
- 把 GEO 洞察扩展回 5 项；如未来需要推荐率、引用率趋势，必须另立合同、聚合和前端功能任务。

## Key Decisions

- 用户确认 GEO 洞察以当前 OpenAPI 和页面的发现率、提及率、准确率 3 项为正式口径。
- 原设计中的“五类趋势”、推荐率/引用率排行和运营验收描述按当前实现修正，不扩展后端或前端功能。
- 推荐、引用仍可作为人工逐篇观测的原始事实和迁移前 `legacy_*` 指标存在；本任务只纠正其被误写成当前洞察正式指标的部分。
