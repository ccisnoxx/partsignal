# 整分支已确认阻断修复

基线：8b2e0dc842be82cf9c2dc01f64d07bdaa4cf319c。六类修复实现aa7f3db8，CI入口修复d43695e5。

## 修改

后端仅8个测试文件：上传夹具补非空稳定session UUID与实际db.info字典；OpenAPI inventory同步256operation/1667增强responses、1411原始responses，保留逐operation全部语义；六个upgrade head场景精确期望0066及对应降级停止，合法冻结0065场景不动。

前端6个生产文件/4个测试文件：Catalog/Questions/Opportunity成功写后先取消lists再校准，保留principal/mount守卫；Catalog删除先过滤行、详情失效refetchType:none、清URL后刷新；Overview/Insights准确限定本页面缺口并给现有工作台/API路径，不新增范围外能力。真实QueryClient组件反例延迟首次GET和URL清理，验证旧revision不回填、删除后详情GET不增加。

## 已执行的定向证据

后端379unit与18真实PG16集成通过（14原有Alembic/SQLAlchemy告警未过滤）；前端旧实现7failed/11passed，修复后80项不同测试通过、typecheck通过、owned ESLint首轮一个未使用import修正后仅该文件通过。green最初一个不存在的筛选路径未执行，已以正确Catalog页面补跑。

命令、基线SHA、dirty状态、UTC起止、退出码、日志哈希与测试文件最终指纹见evidence/targeted-validation.json。原始日志位于受保护本机审查目录。主代理复用两代理成功检查，不重复同范围测试。

## 验证边界

本轮不修改backend应用/迁移或GEO-1007恢复源码；baea420f恢复、迁移runtime、PG16真实恢复和信号证据复用。新代码提交后只做一次独立只读复审与固定SHA完整门禁/CI；治理记录不冒充运行源码重新验证。未合并main、未冻结RC、未生产部署；其他任务人工接受及现场门禁不由本轮自动继承。

## 固定候选验证与收尾

实现提交aa7f3db8c222cd8b9a48bffbf24884c4c34e8151已推送。fresh独立只读复审APPROVE，六类finding全RESOLVED；只覆盖remediation增量，不冒充整历史分支/其他task人工接受/生产批准。多代理audit已关闭校验，无异常。

clean固定SHA run-verify→make verify于2026-10-06T20:21:24Z—20:59:32Z一次运行exit0（约38分钟）：合同/lint/type、3865backend unit、1308frontend unit、1253PG（45告警）、6恢复PG、100k性能、镜像build、32真实栈E2E、GEO三个阶段、498fixture passed/74模式skip、秘密扫描、部署脚本/恢复信号及Compose配置通过。跳过语义保留，合成协议Gate不代表生产。

CI37525885249绑定aa SHA，实际completed/FAILURE：集成1193passed/60failed/6errors/45warnings。失败集中为54对象存储服务未启动、6容器专用合同挂载路径缺失、6恢复fixture缺显式PG16工具。两个frontend shard和verify合同/lint/type/unit/frontend均SUCCESS；后续build/E2E/部署脚本步骤被跳过。watcher于20:56:44自行exit1，21:00查询未发现存活watcher，没有终止或取消远端运行。

新增d43695e5仅修改CI调用为已有make test-integration，该入口提供backend-test合同挂载与健康fake-oss，并随后必跑宿主恢复wrapper及PG16容器工具；不削弱60失败或6恢复断言，不改变普通/恢复集合。该入口在aa的本地完整门禁已1253PG+6恢复真实通过，底层源码/测试/Compose/Makefile/lockfiles未变，复用其行为证据。新SHA仅执行make -n test-integration和sample Compose配置检查，exit0；工作区dirty为治理记录，没有未提交运行源码。新SHA远端CI未触发，不能声称远端通过。fresh新SHA入口独立复审APPROVE（仅CI增量）见evidence/independent-review-d43695e5.md；确认三个来源条件和两段完整集合，未发现P1/P2。任务保留review，PR Draft、main/RC/生产不推进；不因入口改接重复全量，本轮只保留一次本地完整验证和一次远端失败运行。

证据命令/SHA/UTC/exit/log哈希见evidence。治理提交不冒充已重新运行的源码SHA。下一步在获得远端门禁结果后决定准入；其他task人工接受、clean main与候选/现场门禁另行完成。
