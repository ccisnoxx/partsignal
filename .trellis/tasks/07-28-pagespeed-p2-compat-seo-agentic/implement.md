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

- [ ] 在修改 `index.html`、robots、llms 或 Vite source map 前，展示公开风险并
  取得一次明确确认。
- [ ] 未确认时保持这些项 Open/Blocked by approval，不静默实现。

## 4. 经授权实施

- [ ] 设置 `index,follow`、meta description 和 robots `Allow: /`。
- [ ] 创建最小 `llms.txt`，验证 H1 和公开链接。
- [ ] 启用完整外部 production source map。
- [ ] 增加 map 完整性和秘密扫描门禁。
- [ ] 更新 README 和相关测试，删除旧约束。

## 5. 验证

```bash
cd frontend
npm exec -- vitest run
npm run typecheck
npm run lint
npm run build
PLAYWRIGHT_HTML_OPEN=never npm exec -- playwright test --project=e2e
cd ..
git diff --check
```

- [ ] 校验 meta/robots/llms/map 实际构建产物。
- [ ] 执行 Lighthouse/PageSpeed 复测，SEO=100、Agentic=3/3。
- [ ] 执行 Trellis check；高、中问题清零。
- [ ] 文档与产品契约同步；不自动提交、推送或部署。
