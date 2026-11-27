# U02 发布工作区

## Goal

验收 `/publishing/work/$workId` 的发布准备、结果登记、核验、修订交接与事件追溯。

## Requirements

- 前置 U01、F06 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 5.2 节、`11-frontend-redevelopment-task-list.md` U02、OpenAPI 和前端状态所有权规则。
- 首屏只读取 workspace-context；批准 Markdown、平台/账号/阶段、实际结果、附件、核验和事件按服务端数据只读呈现。发布包点击后读取。
- 只按 `available_actions` 和服务端候选展示命令，提交携带 `expected_revision`；409 保留表单与上传，提供始终可到达的显式重载；成功采用 canonical work 并刷新 Context。
- 失败核验交接内容修订，换版后须重登记；成功交接 canonical PublishedArticle ID。六个 hash 章节、键盘和目标宽度可用。

## Acceptance Criteria

- [x] 组件与 model 用例覆盖首屏读取、命令 payload、409 恢复、失败修订及成功只读交接。
- [x] 当前候选浏览器覆盖完整 fixture 闭环、导航和响应宽度；真实服务端闭环在 U07 独立验收。
- [x] 记录实际代码、验收证据及 U03 下一步。

## Notes

- 本项拥有发布工作区及直接测试，不修改服务端工作流和根合同。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：`publication-workspace-actions.tsx` 增加持久可达的 409 重载入口、草稿起始 revision 冻结及无草稿打开/显式重载时的 Context 表单基线同步；显式重载才丢弃草稿与已上传文件。`publication-evidence-upload.tsx` 将上传忙碌状态交给结果表单，上传/校验期间阻止登记、关闭弹窗和重载；完成后携带已校验文件 ID。`publication-workspace.model.ts` 将准备、平台审核、结果登记的备注非空校验对齐服务端 `NonblankText`。
- 直接测试：model/page/evidence upload 3 files / 13 tests 通过，包含 Context 点击后按需获取 Package、409 关闭弹窗后的恢复、后台修订时保留并冻结旧草稿、首次打开时采用新账号/实际结果基线、换版和核验交接。
- 当前候选生产预览浏览器：`publication-workspace.spec.ts` 移动/桌面 12/12 通过，覆盖六个 canonical hash、Core 命令与证据上传、慢上传期间禁止结果登记、409 与 pending、失败→修订→换版→重登记→通过只读交接、typed 初始错误及 375–1920 宽度。`npm run typecheck`、`npm run lint`、`git diff --check` 通过。构建仅有既存大 chunk 提示。
- 独立只读复核发现并促成修正“旧表单值搭配新 revision 覆盖他人更新”；复核确认修复解除阻断。真实后端 Publishing 闭环及不可变历史留给 U07，当前 fixture 结果不替代该门禁。下一步 U03 发布成果列表。

## U07 前补充修复与复核（2026-09-21）

- U06 状态调查发现：换版 POST 成功、完整 Workspace GET 失败时，原 `acceptCanonicalWork` 曾把新 work 与旧 content 拼成混合快照，后续操作可依据旧正文使用新 revision。现改为命令成功后必须读取并校验完整 Context 才解锁；POST 至同步完成全程阻止重复提交，失败时保留草稿/上传并显示已提交状态与页级显式重载。共享 `publicationWorkspaceContextQueryOptions` 校验 work/content/platform 身份，使 route loader 预取与页面共用；页面另检查已提交命令的最低 revision。发布包在途读取遇换版/重载会按 epoch 和最新缓存身份拒绝旧正文写入剪贴板。
- 追加 `publication-workspace-page.test.tsx` / `publication.api.test.ts` 直接 27/27，通过 GET500、旧 revision、六类预取身份错配、延迟 Package GET 两种交错；page/model/evidence upload 3 files / 16 tests 亦通过。`npm run typecheck`、本次修改文件定向 ESLint、`git diff --check` 通过；当前候选 `publication-workspace.spec.ts` 移动/桌面 12/12 通过。两轮独立只读复核先指出复制并发与预取绕过，修复后确认阻断解除，未发现新的确认问题。真实后端仍由 U07 验收。
