# GEO-1003：生产 Browser 硬禁止交付记录

日期：2026-10-05。授权范围为本次实现及定向验证；不自行 done，不提交、推送、部署或操作生产。manifest / Trellis 最终状态均为 **review**，completedAt=null；生产仍 NO-GO，候选与现场证据分别由 GEO-1009/1010 收口。

## 实现与责任

- `backend/app/config.py` 的 production validator 明确拒绝 Browser=true，即使 Monitoring=true；亦拒绝生产 Browser 会话目录、公钥、服务能力文件或服务账号配置。没有将非法值覆盖为 false。
- production input checker 对 Browser 采用独立于模板内容的 literal false 固定边界；允许旧 runtime 省略，显式空值/true/1 等均失败。`app.cli preflight-production-config` 在 Settings 加载阶段拒绝，合法摘要报告 Browser=false。
- production Compose 删除 Browser include，并由共享 backend 锚点固定 `APP_ENV=production`。API/Worker/Scheduler 仍使用同一 env_file 及 `app.config.settings`；Beat 仍从 `app.worker:celery_app` 启动。默认/async/geo-browser/全部 profile 与 shell 环境覆盖展开没有 Browser 服务、profile 或会话挂载。
- deploy/activate/frontend rollback 在维护锁与部署状态变化前调用 checker 的 `--deployment-boundary` 标准库模式，拒绝 runtime/宿主 Browser 非 false、Browser 会话材料、非权威 Compose/多文件 overlay、除 production-async 外的 profile 和非 production runtime。完整输入检查和 backend preflight 继续负责完整应用配置。
- checker 新增为 manifest producer/consumer 同一 9 项 tracked-file 集合，全部测试 producer 与 exact-set 断言同步；旧 manifest 必须重建，不引入兼容回退。按既有发布合同不生成脏工作树候选，新候选由 GEO-1009 冻结。
- GEO-801～803 非生产骨架/加密会话/本地模拟合同保留。Collector 对 production 在 Chromium/健康端点/会话读取前拒绝，即使 Browser=false；错误为固定脱敏 code。不实现真实 Adapter，不访问第三方平台。
- 更新配置权威说明、生产交付 spec、当前能力矩阵、技术架构当前保证和变更记录。GEO-801～803 manifest 历史不改，原 GEO-1001 审计与生产 readiness 记录不改。

工作区任务前已有大量 GEO 改动。`evidence/before` 保存本任务维护文件前态，`evidence/candidate.diff` 与前态比较；不是把整个 Git 工作区归属本任务。无 OpenAPI、数据库、迁移、前端或业务公式变更。

## 实际验证

精确命令/结果及失败修复记录见 `evidence/validation-results.json`。

- Settings、production boundary、production input checker、Worker 配置、CLI、安全边界定向共 **152 passed**。包含 production+Monitoring=true+Browser=true 的真实 API、Celery worker/beat、preflight 启动失败；带网络/会话审计钩子的负例先于副作用拒绝；development/test 完整显式开关组合保留既有父子合同。
- `test-geo-configuration.py`：17 组正例启动及共享最终 Settings、production Browser 负例；真实 Compose 的所有 profile/shell 覆盖展开零 Browser/会话，启动外部调用为零。
- `test-geo-browser.py`：dev/staging profile 及资源/网络/凭据隔离保留，prod 显式与全部 profile 零 Browser；另保存 `evidence/production-compose-summary.json`：7 个普通服务、唯一 production-async profile、Browser service/session mount count 均为 0，三进程 production/Browser=false 一致。
- Collector 单元 **14 passed**，lint/typecheck 通过；GEO-803 本地模拟合同 **27 passed**，18 个结果通过 backend 权威类型，secret_scan=0，外网在发送前阻断。
- `test-deploy-production.sh` 自检通过：完整候选 manifest、registry/local 顺序、三条部署/激活/回滚路径、两阶段状态机及输入检查；真实本地 Docker Engine 7 服务正例/3 旧 label 负例，测试 container/network 均归零。初次失败为本任务 fixture runtime 路径变化但断言仍引用 .env.example，修正断言后复验通过，没有重试未变化的环境故障。
- 定向 Ruff、四个 shell 脚本语法及 Trellis context validate 通过；初次新测试 import 顺序错误已修正。
- 按要求运行完整 `git diff --check`，退出 **2**：仅未改 GEO-1001 审计已有 12 处 Markdown 硬换行尾空格；不宣称完整工作区检查通过。本任务 30 个维护文件与前态分别执行 `git diff --no-index --check`，无空白错误；退出 1 仅表示文件存在差异。见 `evidence/git-diff-check.log` 与 `evidence/diff-check-results.json`。

## 验证边界与恢复

没有执行目标生产部署、实际三进程配置读取、生产容器/session/key 材料清点或真实 AI/OSS Gate。本地 Compose/进程证据不替代 GEO-1010 现场零服务/零材料证据。没有运行全仓 make verify、PG 业务全量/E2E/浏览器矩阵；本次未改变业务请求、数据、认证或 UI 流程，定向 startup/Compose/deploy/本地合同覆盖本次边界，新冻结候选门禁仍由 GEO-1009 执行。

无数据迁移/回填/不可逆写入。本任务恢复路径为回滚可识别源码/config，并重新生成一致候选 manifest；不能混用旧 manifest 和新 checker。生产禁止不因 Browser 后续排期自动解除，重新开放必须另行产品/平台/环境授权与独立变更。

独立复核发现候选命令仍使用旧 8 项 tracked-files；已修正 Hostdzire 附录/上线流程，并用 AST/正则比较附录/producer/consumer 精确 9 项集合一致。该修正仅文档，无需重复已通过的部署检查。最终复核与已验证的审计 Bundle/Digest 在收尾后写入本任务 evidence；复核结论不代表人工 done 或生产放行。

## 最终交付

独立只读复核已完成，确认的 P2 文档遗漏已修复并解除，无剩余确认发现；见 `evidence/independent-review.md`。Bundle audit_id=`20261006T040310Z-geo-1003-production-browser-ban-8c250d3e` 已关闭，audit-verify passed，无审计异常；任务 evidence 保存校验后的 SUBAGENT_EXECUTION_DIGEST JSON/Markdown。Manifest / Trellis 均 review，不自行 done；GEO-801～803 完整历史条目与其他任务保持原状态。
