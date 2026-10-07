# GEO 浏览器延期与人工优先范围调整：实施与证据

## 决策与审计

用户当前请求明确取代此前 GEO-804 实施要求，授权本轮文档、任务治理和发布路径调整。ADR-006 接受依据是用户明确产品决策，不代表批准真实平台自动化或生产启用；不虚构具名审批人或后续负责人。

开始前读取根 AGENTS、相关 Trellis workflow/spec、GEO README/PRD/业务架构/流程/技术架构/路线图/WBS/manifest、ADR-005 和 801～804 记录，检索确认 805～807 没有实施任务目录。补读现有 MANUAL Schema/服务/表单、文件资格、指标资格、Browser 源码/开关/Compose 和执行提示词。任务前工作树已有大量未提交 GEO 变化，沿用 geo/GEO-804，不提交、切换、推送、上线或归档。

| 任务 | 调整前事实 | 调整后 |
|---|---|---|
| GEO-801 | done；独立隔离骨架，真实容器/默认 profile/STOP/边界测试，人工接受记录完整 | 保留完整条目、代码和证据 |
| GEO-802 | done；加密会话、访问/撤销/审计，PG/迁移/E2E，人工接受记录完整 | 保留完整条目、代码和证据 |
| GEO-803 | done；本地模拟站/合同，本机及隔离容器各27通过，人工接受记录完整 | 保留完整条目、代码和证据 |
| GEO-804 | blocked；只有 preflight 和本地基线，唯一平台批准及 staging 授权/入口缺失，真实 Adapter 未实施 | deferred / post-core；原阻断和日志保留 |
| GEO-805～807 | planned；无实施记录，不把前序局部基础设施算作交付 | deferred / post-core |

以上是审阅已有证据，不声称本轮重跑历史 Browser/PG/E2E 测试。R8 没有直接 R7 依赖，隐式门禁来自旧 PRD 自动化/界面首发、路线图 R6→R7→R8 和无条件会话恢复。

## 变更与不变量

新增 Accepted ADR-006 和人工 GEO SOP；产品/业务/技术/路线图/WBS/manifest 统一 MANUAL 正式采集、R6→R8、R7 可选后续。804～807 的延期原因、恢复条件、post-core 和待定责任完整；已有804当前Trellis同步deferred，原证据不改写。R8 901/903 条件性清理/恢复、904/906 Browser false/无生产会话；延期不豁免实际材料的保护和清理，也不放宽其他安全门禁。

执行模板/指南、8份R7/R8单任务提示词及合并版同步，不执行延期提示词。链接检查发现合并版索引69个旧锚点不对应实际标题，本次已修正该维护文档的索引，不改原任务目标。导航、追踪矩阵、变更记录与SHA清单同步。

SOP以当前冻结环境/单截图/有效URL合同为准，说明人工工作分配没有独占claim、回答与来源截图需要合并、缺URL不猜测、部分引用证据先草稿补证、提交冻结、分析复核/资格/重复采样。没有新增备注字段、第二套公式或补写历史入口。

OpenAPI、database、Alembic、后端/前端、Collector和部署配置未修改，无新revision/前滚/回填，无数据操作。业务事务、锁序、lease/revision、幂等、并发、权限和错误映射不变；deferred仅为交付治理状态。未读取第三方账号/Cookie或访问真实平台，不实现或模拟真实Adapter，不删除801～803。

## 验证方法与结果

本任务 `evidence/before` 保存起点文档与804当前记录；`protected-sha256.json` 保存1,295份既有源码/合同/部署/配置摘要。`candidate.diff` 和 `changed-files.json` 只比较本次起点，不把整个脏工作树归因本轮。

- `UV_CACHE_DIR=.cache/uv uv run --project backend python .trellis/tasks/10-05-geo-browser-scope-adjustment/evidence/validate.py --baseline`：exit0，起点manifest71任务/状态合法/依赖无环；537个内部链接中69个旧合并索引锚点失配，起点证据保留。
- 同命令不带 `--baseline`：exit0，新增deferred合法，ID/依赖有效无环；非授权任务条目/全部依赖保持，801～803完整相等，804～807延期字段齐备，R8无传递延期依赖；8份单任务/合并提示词及4项R8的WBS/manifest一致。最终链接/摘要/命令结果见evidence/validation.json和validation-commands.json。
- `python3 .trellis/scripts/task.py validate .trellis/tasks/10-05-geo-804-approved-browser-adapter`：exit0；两个context jsonl合法（均0条），不限制deferred。
- `python3 .trellis/scripts/task.py list --status deferred --json`：exit0，准确读出804为deferred，未把它计为completed。
- `python3 .trellis/scripts/task.py validate .trellis/tasks/10-05-geo-browser-scope-adjustment`：exit0；新治理任务context合法。
- Node离线默认配置探针：实际调用readConfiguration({})和admissionCode，断言Browser=false/monitoring=false/COLLECTOR_DISABLED通过，精确脚本见evidence/browser-default-command.json，结果见browser-default.log。
- `git diff --check`：实际运行exit0；另对本轮新/未跟踪文件运行no-index空白检查，最终结果见evidence。

仓库未找到专用manifest校验器或拒绝deferred的状态schema；不为这次文档变更引入生产校验框架。evidence/validate.py为本任务离线验收脚本，不改变运行时。

起点文档包只有核心PRD的SHA条目失配（见baseline-checksum-mismatches.json）；本轮实际修改该PRD，合法同步新摘要，不改其他历史内容以掩盖漂移。最终全包SHA命令结果另存。

## 验证边界

未运行Settings单元、Compose config或全量lint/typecheck/verify/PG/E2E：本轮配置和源码没有变化，已核对默认配置并执行Collector离线默认探针，文档/治理风险由定向校验覆盖。未执行staging/生产smoke、备份恢复或生产数据库会话扫描：本轮不部署/访问平台，实际环境Browser=false/无生产会话仍是GEO-904/906后续必需证据，不能把静态默认值视为生产事实。

恢复R7须产品重新排期与责任指定、唯一平台及账号用途/环境/频率并发/保留停止合规范围、受控staging人工授权/入口，逐项依赖/当前安全合同重验。只有重新授权后恢复804～807；实现与本地验证后review、人工接受后done，生产启用另行授权。本轮不实现任何R8或Browser业务任务。

## 独立复核与最终交付

使用multi-agent-orchestration，fresh critical_reviewer只读复核发布门禁与SOP边界；结果和validated审计Digest收录本任务evidence，不把运行时完成自动视为验收通过。最终状态与覆盖记录在task.json；本地交付仅review，不自行标done。

## 最终本地交付结果

全部71任务状态/依赖有效且DAG无环，R8没有延期祖先；801～803完整保留，804～807deferred字段和8份提示词一致。最终内部链接检查覆盖docs及两个本轮Trellis记录，608项、0失效。根SHA清单121项与提示词SHA清单73项均实际shasum通过；旧PRD失配已随本轮授权修改同步。git diff --check通过，本轮32份维护文件及治理任务/验收脚本共39份no-index空白检查无诊断（exit1表示有正常内容差异，不是通过退出码0）。

Node实际默认配置探针通过，1,295份既有源码/配置摘要一致，未新增这些目录中的源码/配置文件，生产runtime仍未验证。完整文件列表见files.md，精确命令/工作目录/退出码见evidence/validation-commands.json，原始检查数据与差异在evidence。

独立review发现部分引用风险已修正并复核；文本API/页面入口说明由主代理修正后自查，不冒充独立再次复核。Audit Bundle 20261005T130659Z-geo-browser-scope-adjustment-dd53e77f已finalize/verify通过；有一条unclassified independent-review.md辅助文件类型warning，无校验错误或Digest异常，产物已纳入哈希清单。validated Digest为1次只读执行、1次验收、1次独立复核，无活跃Worker或未知写入。子任务验收不表示本治理任务done或生产批准。

新治理任务in_progress→review，804 blocked→deferred，未自行标done；completedAt保持null。未提交、推送、上线、归档或实施后续任务。后续901～906照当前依赖与条件验收执行；恢复804～807所需条件见ADR006/manifest，不在本轮执行。
