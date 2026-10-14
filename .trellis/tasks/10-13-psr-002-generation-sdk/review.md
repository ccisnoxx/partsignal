# PSR-002 独立只读复核

## 结论

fresh critical_reviewer 未确认本轮增量存在发布阻断问题，未观察到SDK调用、并发收尾或作业终态保护新增阻断。对照本轮before基线与当前五个候选文件；前置PSR-001、部署或其他工作区修改未归入本轮。主代理依据可行动复核范围和明确验证限制接受该审查报告，不代表任务已被人工接受。

## 覆盖

- generation.py:322：两类Job共用AIProvider.chat_completion，保持冻结system/user、模型/参数/普通Header与敏感名称，Key和所列敏感值只在边界解密；PUBLIC、当前事实/任务、配置、测试注入守卫没有绕过。
- generation.py:334：json.loads和GeneratedDraft由业务层拥有，严格四字段、额外字段/空白拒绝；AppError固定且抑制原始异常context，无内容修复/提取/补值或成功替身。
- ai_provider.py:188：核对安装OpenAI3.29.0公开create/raw-response入口；max_retries=0、无环境代理、禁止重定向和关闭路径保留，duration与成功收尾字段兼容。调用者搜索未发现需迁移的ChatCompletionResult构造。
- generation.py:504：异常先rollback释放候选正文、主线/指标与行锁，随后只锁Job且仅RUNNING→FAILED。租约先提交WORKER_LOST、迟到业务/HTTP异常及已经提交的终态不会被覆盖。异常路径无新增Task/Source逆序锁，成功Job→Task→Source锁序保持。

## 审查者实际证据

读取原始日志并核对：迟到异常修复前4failed、修复后4passed（完整Job行比较、一次调用、无ContentVersion）；首轮58集成通过；异常finalizer25passed/37deselected。审查了最终提交回滚、迟到成功租约及fact/task/source/mainline在途失效测试的持久状态断言。

独立执行无落盘命令形态：`PYTHONPATH=backend APP_ENV=test CONTENT_GENERATOR=openai-compatible backend/.venv/bin/python -B - <<'PY' … PY`。实际SDK+httpx2.MockTransport，12种异常外层结构×两类Job，共24反例：顶层list/null/数字/字符串、异常choices/message/content、非法usage。全部安全AI_RESPONSE_INVALID，每例一次请求，没有未映射异常或正文泄漏。还执行diff-u、rg/nl/sed/cat/ls读取基线、合同、直接调用者及日志。

未执行Git操作、修改源码、建库、启动服务或真实供应商请求。没有独立重跑PostgreSQL/Redis；主代理143单元、Ruff/mypy未在复核中重跑，不能记为审查者独立执行。

## 未验证边界

真实供应商、生产HTTPS、全仓门禁和GEO旧栈未覆盖。已授权SDK轻量URL及移除旧响应上限按任务合同接受。结论为定向高风险复核，不是生产发布门禁。

## 审计

audit_id：20261013T094005Z-psr-002-generation-sdk-80db26da。Digest生成与audit-finalize/audit-verify passed，Bundle closed：1派发/1报告验收/1独立复核，0执行异常/0残留活跃worker。复核期间候选及当前modified/untracked源码SHA逐项未变化，未观察到子代理源码写入。Agent TOML模型/推理配置不作为runtime遥测。额外保存的实际prompt.txt有一条未分类artifact提示，无校验错误。
