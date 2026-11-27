# PSR-005 Task Brief

## 目标与依赖

清理 Browser Collector 当前文档和默认验证入口。PSR-004 在维护 manifest 为 done，Trellis 为 completed，2026-10-13 人工接受记录已核实。当前分支 chore/PSR-005-defer-browser-collector；本任务不提交、推送、部署或调用真实 Provider。

当前支持人工 GEO 数据录入和已经实现的 API 型采集。Browser Collector、浏览器会话材料、自动登录和浏览器页面采集属于后续功能，当前版本不支持、不开启、不部署。

## 盘点与范围

执行用户给出的精确 rg 搜索：402 条命中。逐行分类见 evidence/references-before.tsv；当前产品、开发/部署/运维说明及默认 Make/Compose/E2E 入口清理；隔离源码/测试、历史合同/ADR/交付记录保留。普通前端 Playwright 不因名称含 browser/session 被删除。

Makefile 默认 bootstrap/lint/typecheck/test-unit 执行 Browser 包；e2e 前置 Browser contract；verify 经 test-deploy-scripts 间接执行 Browser Compose 检查。dev/staging 默认 include Browser overlay。e2e-local 默认生成 Browser 会话目录/RSA公钥并选择 Browser Session 专属 spec，需改为显式选择才准备；其他真实栈用例、secret scan、资源清理与 API 三阶段验收保持。

## 实现边界

移除默认包安装/检查、Browser 专属合同和 Compose include。保留显式实验检查入口，隔离检查使用显式非生产 overlay，不通过默认 Compose 暴露服务。清理当前 Browser 启动/调试、会话配置/密钥/探针/挂载和默认门禁教程；当前架构图只展示已支持采集。README/开发/测试/运维及 GEO 当前文档统一范围说明。Accepted ADR、历史 task/交付证据不重写；更新实际改动 GEO 文件的 SHA256SUMS 与 CHANGELOG。

生产 Browser 禁止校验及拒绝 overlay/未知 profile 的边界保持。无 OpenAPI、database.md、ORM、Schema、路由、前端页面、Alembic 或 AI SDK 修改；无数据库对象删除。GitHub Actions 与质量门禁分层属于 PSR-006，不实施。

## 验收与停止条件

- git diff --check；精确残留搜索并逐项分类。
- make -n bootstrap lint typecheck test-unit e2e verify，检查传递依赖无 Browser 专属执行，普通 Playwright/API Collector 仍在。
- Dev/Staging/Prod 真实 Compose config：不提供 Browser overlay 时，默认、显式 Browser profile、全部 profile 均无 Browser service/会话挂载。
- 当前文档一致性、链接及改动 GEO 校验和检查。
- 受影响 Make 目标定向实际运行：bootstrap 依赖安装、lint/typecheck/unit（包内过滤）、GEO 配置与 staging 脚本、E2E 生命周期与 Playwright 收集；不运行完整 release verify。
- 保留代码若影响生产启动/当前合同、必须更改公共合同或删除数据库对象、依赖非done、无法保护前序修改则停止并 blocked。失败先诊断，不无变化重跑；未执行不得记通过。

## 工作区保护与交付

任务开始有前序 SDK、部署、infra/AGENTS 和文档 modified/untracked；本轮基线保存在系统临时目录，最终只核对本轮增量并删除临时快照。不覆盖并发/前序修改。正式引用分类、验收结果、变更清单与限制保存于本任务；完成维护 manifest 与 Trellis 置 review，等待人工接受。
