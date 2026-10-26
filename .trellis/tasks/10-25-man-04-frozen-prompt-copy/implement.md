# MAN-04 冻结完整问题复制实施记录

## 交付状态

2026-10-25：本地实现、必要定向验证和本轮差异核对完成，task=`review`，`completedAt=null`；未部署、未记录用户验收。MAN-01～03保持原本地review，不重复实施；MAN-05/06保持规划且未获本轮实施授权。父清单新增本次交付证据，下一可选MAN-05，不据建议顺序启动后续实施。

## 实现及来源核对

- 人工录入的 `FrozenInput` 与运行详情的“冻结问题全文”均原已展示 `input_snapshot.prompt.prompt_text`。后端 `manual_entry_context` 直接从本Run的 `run.input_snapshot` 构造上下文；不需要请求当前题库或计划模板。
- 新增geo-runs内的 `FrozenPromptCopy`，复用现有Button、`navigator.clipboard.writeText`及页面内 `aria-live` 反馈。两个位置均从其现有Run输入快照传入完整 `prompt_text`，不trim、不拼装、不转Markdown/HTML，不使用 `canonical_question` 或回答记录里的另一份问题字段。
- “复制完整问题”为 `type=button`，不参与保存或提交；复制中禁用自身避免重复写入，成功明确提示，API不可用/拒绝/失败均明确提示可手动选择原文。原有全文展示保留。
- 两个挂载位置均按Run ID隔离复制状态，切换运行后的迟到完成不会给新Run显示成功；新按钮使用新Run原文。
- 人工SOP更新入口、来源和失败处理，仅同步SOP对应的SHA256清单行。无API、Schema、持久化、权限、状态机、后台任务、依赖或部署变更。

## 实际定向命令及结果

项目根目录：

```sh
npm --prefix frontend run typecheck
npm --prefix frontend run test -- src/domains/geo-runs/frozen-prompt-copy.test.tsx src/domains/geo-runs/manual-editor.test.tsx src/domains/geo-runs/run-detail.test.tsx
```

结果：typecheck通过；3个测试文件共31个用例通过，其中本轮新增9个。两处展示均覆盖精确快照原文、与标题/回答问题字段不同、首尾空白、CRLF/LF、空行、缩进、Markdown/代码/HTML文字、键盘触发、拒绝写入、API不可用、失败后显式再试、复制中禁用、跨Run迟到完成与提示重置。完整人工表单组件用例确认复制保留未保存回答和可保存状态，不发PUT/POST、不触发提交回调。原运行详情证据测试仍通过。

`frontend/`目录：

```sh
./node_modules/.bin/eslint src/domains/geo-runs/frozen-prompt-copy.tsx src/domains/geo-runs/frozen-prompt-copy.test.tsx src/domains/geo-runs/manual-editor-view.tsx src/domains/geo-runs/manual-editor.test.tsx src/domains/geo-runs/run-detail.tsx --max-warnings 0
```

结果：受影响5个源码/测试文件lint通过。实现完成后集中执行一轮检查，未因任务收尾重复运行已通过且输入未变的检查。

```sh
git diff --check
git diff --cached --check
git status --short
```

结果：diff检查通过。逐文件比较本轮开始时的工作区哈希，只改变预期7个既有文件，另有本任务源码/测试及任务资料；没有修改其他基线文件。HEAD仍为 `a4f9bbd581aa558cb3567d6da1f0c5509998bfd0`；index逐字节相同，原74项暂存删除保留。SOP清单只有第12行随当前SOP同步，其他清单行原样保留。

## 证据复用及限制

MAN-01～03的既有本地实施状态依其原记录保留，MAN-03来源为 `../10-25-man-03-plan-batch-context/implement.md`；这些记录不充当本轮复制交互的新验收证据。本轮组件测试使用Testing Library的Clipboard stub验证传入API与回读的文本及失败反馈，不能等同真实浏览器/操作系统剪贴板、权限提示、实际外部平台粘贴或用户验收。

按照 `docs/testing.md` 仅验证受影响前端组件与类型；未运行完整make verify、全量E2E、真实浏览器Clipboard验收、生产构建、后端/数据库/合同/镜像/发布门禁。不存在相应代码或协议变更，不重复MAN-01～03后端或业务流程验证。后续部署/用户接受仍需按实际环境验证，此处不声明全量门禁通过。

保留上传验收 `NOT_RUN_NO_EXISTING_PLATFORM`。本轮未接入浏览器自动化、未创建平台、未操作线上、未提交/推送、未新增自动跟进、未重复检查OSS自然清理。

## 收尾与资源

本轮未启动浏览器、API、前端服务器、数据库、容器或其他后台服务，三个检查进程均正常退出。删除CLI为新任务生成但未使用的两份示例JSONL。一次性基线和原文件副本在最终保留核对后已从本轮系统临时目录删除；不保留截图、报告或其他非源码产物。Trellis只清除本会话活动指针，任务保留review，不归档、不提交。
