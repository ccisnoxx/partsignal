# 实施计划：P2 兼容性、SEO 与 Agentic

## 1. 无公开面兼容修改

- [x] 将项目 `:has()` 改为显式 class/rootClassName。
- [x] 增加 mask 不支持时的纯装饰 fallback。
- [x] 增加 scroll、长标签、backdrop、打印和 focus 跨浏览器测试。
- [x] Chromium/Firefox/WebKit 验证所有 Baseline 项。

实施与结果见 `research/baseline-compatibility-2026-07-28.md`。

## 2. 人工审核

- [x] 执行十项无障碍矩阵，记录步骤和证据。
- [x] 修复发现的问题并补回归测试，重新跑完整矩阵。
- [x] 执行结构化数据三重验证并记录 0 实体/0 错误或修复实际错误。

人工记录见 `research/manual-audit-2026-07-28.md`。Google Rich Results Test
匿名页面要求登录；没有借用用户账号，改用 PageSpeed 抓取结果、渲染 DOM 与
Schema.org Validator 三份独立证据关闭该项。

## 3. 公开面确认

- [x] 在修改 `index.html`、robots、llms 或 Vite source map 前，展示公开风险并
  取得一次明确确认。
- [x] 未确认时保持这些项 Open/Blocked by approval，不静默实现。

## 4. 经授权在工作区实施

以下勾选只表示本地文件、门禁和测试已完成，不表示已发布到生产：

- [x] 设置 `index,follow`、meta description 和 robots `Allow: /`。
- [x] 创建最小 `llms.txt`，验证 H1 和公开链接。
- [x] 启用完整外部 production source map。
- [x] 增加 map 完整性和秘密扫描门禁。
- [x] 更新 README 和相关测试，删除旧约束。

## 5. 验证

- 已通过的三浏览器兼容矩阵、十项人工检查和结构化数据检查不再重复。
- P2 代码未再次变化时，不运行全量测试、E2E 或构建。
- 唯一发布候选只运行一次 production assets/秘密扫描门禁和受影响 smoke；
  部署后用同一次 PageSpeed 关闭 source map、SEO 与 Agentic，只有失败项复测。

- [x] 校验 meta/robots/llms/map 实际构建产物。
- [x] 执行一次 Lighthouse/PageSpeed 复测，SEO=100、Agentic=3/3；
  source map、robots、`llms.txt` 和 Baseline 审核均通过。
- [x] 执行 Trellis check；高、中问题清零。
- [x] 文档与产品契约同步；不自动提交、推送或部署。

授权、实现和本地产物证据见
`research/public-surface-implementation-2026-07-28.md`；线上状态与 PageSpeed
结果见 P0 的 `research/first-production-batch-2026-07-28.md`。
