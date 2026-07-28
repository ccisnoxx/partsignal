# 最终发布源门禁复核

## 基线

- 复核时本地 `main`、HEAD、`origin/main` 与远端 `refs/heads/main` 均为 `44dac9e55db38264acca1f91797b5b636dc55994`。
- 首次检查工作树为空；独立检查期间，PageSpeed P2 公网资产相关文件再次出现未提交改动，说明并行修复尚未真正结束。

## 已确认阻断

1. 从已提交 `44dac9e` 单独制作 `git archive` 后运行：

   ```sh
   node deploy/scripts/check-nginx-security.mjs
   ```

   结果为 exit 1：`frontend/nginx.conf` 在 source map location 定义 `X-Content-Type-Options`，而仓库检查器禁止容器层重复外层项目安全头。

2. 已提交 `frontend/README.md` 和 `frontend/tests/e2e/theme.spec.ts` 仍断言 `noindex`、全站 `Disallow` 和无生产 source map；同一提交的实际公开资产行为已经改变，文档、测试与构建门禁不一致。

3. `44dac9e` 跟踪了 296 个 `.playwright-cli` 文件，Git 对象总大小约 13.5 MB。`git diff --check ccdab3b..44dac9e` 还报告其中一个 YAML 有尾随空格。部署 PRD 明确禁止把临时浏览器产物带入 release。

4. 复核期间工作树重新出现 `frontend/README.md`、`frontend/nginx.conf`、`frontend/package.json`、`frontend/vite.config.ts`、主题 E2E 和新的生产资产检查脚本等并行改动。部署任务不得接管、暂存或隐藏这些改动。

## 已通过检查

独立只读检查确认已提交对象的迁移定向测试、观测/发布后端测试、前端定向测试、OpenAPI 运行时与生成类型、ruff、mypy 和前端 TypeScript 检查通过。

## 结论

不得制作 release 或进入 Hostdzire 写操作。等待 PageSpeed P2 所有者完成安全头所有权、公开资产契约和 Playwright 临时产物清理并提交；随后从新的干净 `origin/main` 重新执行全部来源门禁。
