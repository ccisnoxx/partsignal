# 实施记录

已只读清点Hostdzire，7项目容器、3网络、9其他容器、132个项目image条目、68个release条目，shared两份env；原冻结manifest SHA仍匹配。测试数据永久删除授权已明确。

已完成本地38项staging模板、首次自动生成工具、9项AI通用非secret参考、完整字段/模式说明与既有staging harness回归。未生成实际服务器新配置，未读出secret值，未执行远端写入。定向日志/退出码/bytes/SHA位于 /Users/sc/.codex/audits/development-preview-cleanup-20260928/validation-results.json。

精确清理脚本先dry-run，再独立critical review；NO BLOCKER后才执行已授权清理。不重新部署。

## 执行前复核与一次部分失败

初始独立critical review为NO BLOCKER，绑定host-cleanup.py SHA `219c987664bd97ad0cb47815bf2602def861054d9a26c777f92b38535624878f`。修复了固定删除名单/identity与bind重叠保护；初始guard回归12断言通过。

2026-09-28T09:57UTC首次执行exit1：配置检查/reload后即时公网probe未410，已恢复旧site SHA；7容器/3网络和数据均未删除。只发生历史配置备份保留搬移。原执行日志332bytes SHA `cc3eda219169a9545047e44fd4eacf9633692017203f85d1618e8e7ac793a300`，现场只读证据见cleanup-failure-readonly.json。异步reload尚未生效是符合现场的推断，首次日志无逐路径codes，不能确证。

精确续作host-cleanup-resume.py保持原固定删除身份，不重复搬配置；公网三个路径按实际响应等待410，30s时限、每curl5s、无sleep，失败仍在停容器前恢复site。新dryrun exit0，真实函数抽取模拟3项barrier回归通过；安排fresh独立critical review后才能续作。

本地已实际生成Git忽略的 `.env.staging`：38项、6个自动secret、0600；未打印secret、未上传。通用 `.env.ai.json` 为9项非secret参考，0600；不作为服务自动加载器。日志/receipt见local-preview-config-preparation*。

## 最终执行、只读复核与完成

续作fresh critical review为 **NO BLOCKER**，绑定SHA `89813bfa50bbb5ce23cf151c28daa01410d823b533d62352fa20d57b2ed99b29`（72894bytes）。30s期限按每curl剩余预算和每curl返回后严格检查，5项回归通过；reviewer独立复验慢4.9s与late410反例。原清单26项project_paths，其中除ROOT实际删除25项，早期派发的24项是描述计数错误，未改变任何目标。

2026-09-28T10:06:58Z—10:08:04Z续作成功（65.416s，exit0）。首次本轮公网codes为根200/API410/object-storage410，第二轮均410，才进入停止/删除；该实际过渡支持前次失败由异步reload尚未完成导致。清理7容器/3网络/65旧release条目/46旧测试备份/25非ROOT路径/ROOT_REMOVE其余3项/130具体旧image tags/1 unused baseline volume；永久删除原测试PostgreSQL、Redis与上传数据。未使用prune/force/down/手工relabel，不部署。

最终独立于执行脚本的只读核验：project container/network/volume/port(19000/19001/19080)/data/temp均0；ROOT仅releases/shared，release恰3冻结证据、image恰2冻结身份；9其他容器ID/image/running/restart_count/OOM/StartedAt与删除前精确相同。shared两份env在执行中hash不变、0600；5历史配置备份+原site备份+旧NGINX项目备份共7项，保留目录0700；其他Nginx摘要不变，nginx-t通过，公网三探针410。quarantine与cutover状态文件不存在。make verify、新release、manifest、maintenance、clean-init、activation、observation及重新部署均 **NOT_RUN**。

当前盘使用率由63%降至56%，可用空间约增加7.66GB（df前后有宿主运行微小变化）。服务器保留路径：`/root/partsignal/shared/.env.staging`、`.env.production`、`shared/retired-configuration/`；旧冻结3条目保持原release路径与SHA，两个镜像保持原ID/tag，仅为历史失败证据，后续不能复用。

本地准备及说明、部署staging harness、Nginx安全、syntax/lint、archive精确allowlist、secret高信号扫描通过；当前修改未提交/推送，不把本次结果外推为新的Repository Release Gate。候选工作树仍clean，main保留前一配置任务与本次未提交工作。I04/I04-2/总体任务保持in_progress，Production切换按用户当前开发阶段决定暂不推进。

### 日志证据

- cleanup-resume-execution.log：exit 0，1150bytes，SHA `db606bc103b38b0797dccff2a44e3af8f66eb884016714b9682d70cdf871a559`。
- cleanup-post-verification.json：核验exit0，5060bytes，SHA `5b488dacac6a8694b3a3f0ce121cd586a911133192bd7b1c1f0855f36cf3dbf8`。
- cleanup-execution.log：首次失败332bytes，SHA `cc3eda219169a9545047e44fd4eacf9633692017203f85d1618e8e7ac793a300`，保留为真实失败证据。
- staging-regression：exit0，266bytes，SHA `8ae2c35463a7303205fdcdd2f6d0231cadc926219bb4f1e424565dfac0378b3c`。
- prepare-lint：exit0，19bytes，SHA `82b3e6a6c090a57601d22943bd23fca9218d1031dbe5a7b754092f9a156b4f18`。
- shell-syntax：exit0，0bytes，SHA `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
- diff-check：exit0，0bytes，SHA `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
- secret-scan：exit0，47bytes，SHA `04db04835824108b8eb1709cd2a726b5e9719623eeaa15beea3f2cba411f3f86`。
- archive-regression：exit0，364bytes，SHA `2863be1a45105e7a9d99df261b03b66ab54879ff90995c7c5c257c4d7ecd5f97`。
- archive-shell-syntax：exit0，0bytes，SHA `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
- archive-diff：exit0，0bytes，SHA `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
- cleanup-guards：exit0，55bytes，SHA `231b326db52d2f7090c0ff5367b43691f279835b3573ba6e791172580bddc33b`。
- cleanup-dry-run-reviewed：exit0，171bytes，SHA `b86998d8172e85d7a3fcd648758d744f9a288067b266e81bc87feae3ebe6879b`。
- cleanup-resume-dry-run：exit0，171bytes，SHA `b86998d8172e85d7a3fcd648758d744f9a288067b266e81bc87feae3ebe6879b`。
- cleanup-resume-probe-regression：exit0，119bytes，SHA `fc10f46aa08e13e53bd7a8641a3e3b2c512538917f16f1406d31e3820932b8e7`。
- cleanup-resume-dry-run-final：exit0，171bytes，SHA `b86998d8172e85d7a3fcd648758d744f9a288067b266e81bc87feae3ebe6879b`。
- cleanup-resume-probe-regression-final：exit0，167bytes，SHA `26d17c0646d230ff98c91d15507fe108c820b45159b43ad7e7e6e04543ce8621`。
- 额外local-preview-config-preparation.log：exit0，91bytes，SHA `b6f1fcc15005b07e7d532034621fcf75618bc37e690bbeedb10e9172816d9b14`，实际生成38项/6secret/0600，未上传。

### 下一步

等待用户明确通知再部署开发预览。届时选择并单独交付预览配置，源码/部署门禁通过后新建独立release，Docker初始化空PG/Redis和账号CLI，不复用旧冻结失败证据。真实AI可在管理员页面创建channel/model并输入Key，先test再显式启用；测试真实AI时才需要供应商HTTPS base/modelID/Key和必要Prompt事实任务。Production专用TTY/clean-init交接不成为当前界面预览前置条件。

### 最后收口

final-secret-scan：2466个tracked/unignored候选文件，0高信号secret，exit0，47bytes，SHA `7d5dd4f1d0937ee1977db553a4afd894ebe7fa90ab61ba3b69741676bed1acb3`。最终diff-check exit0/0bytes。新增私有env/AI参考全部Git忽略，未查看或输出值；本次无backend/frontend/contracts/migration改动，候选worktree仍clean。两阶段审计已closed/verify通过，2执行尝试/2验收/2独立复核、0异常，digest为真实renderer产物。配置说明打开请求已queued至当前chat。
