# PSR-003 独立复核记录

## 首轮候选

Fresh critical_reviewer 在 ai_provider.py 的管理员 Header hook/Collector允许名称/raw返回.content路径确认P2：X-Stainless-Raw-Response:false或stream覆盖SDK的true控制值，完整HTTP200改返回APIResponse无.content，随后AttributeError，Worker把已提交SENT保守关闭为UNKNOWN，违反明确HTTP完成态。普通或敏感Header均可触发。

独立使用安装openai3.29.0的无落盘MockTransport反例与正常对照确认1次callback/1次HTTP200。另13项HTTP307/401/403/429/503、ConnectError/ReadTimeout/RemoteProtocolError、AppError/APIConnectionError callback原异常/零SDK、超限/重复键/非法UTF8检查通过且资源关闭。未独立重跑PG/pytest或真实Provider。其他范围未确认新增缺陷；报告作为可行动复核交付验收，不表示首轮候选可接受。

## 修复与回归

AIProvider._client在validate_header归一化后拒绝x-stainless-raw-response，固定INVALID_HEADER/422，先于客户端创建/授权/SDK启动。Collector映射配置失败为NOT_STARTED；普通/敏感Header其他支持及Latin-1不变，不静默忽略控制值。

10个反例在修复前失败（8个GEO提前执行callback，2个共享入口已有I/O且分类错误）；修复后network/provider/generation/collector直接回归185passed，Ruff/mypy5运行时文件与diffcheck通过。未重跑与本次Header修复无关的PG全组。

## 修复候选的fresh独立复核

另一位fresh critical_reviewer通过64项无落盘python -B+MockTransport检查，确认P2解除、定向范围无剩余发布阻断：

- 30个GEO普通/敏感、三种大小写、false/stream/raw/true/arbitrary值，在callback/SDK/transport/客户端创建前拒绝。
- 16个raw/文本/Models/连接测试入口反例固定INVALID_HEADER/422且真实SDK方法零调用。
- 10个AIProvider/Collector callback AppError/OSError/SDK connection/timeout/status场景保留原异常对象、零SDK、已有客户端关闭。
- 8个正常及相邻控制字段场景：raw返回LegacyAPIResponse原字节、文本/Models正常、Latin-1转发、客户端/响应关闭。

静态追踪____stainless_override_cast_to在request options阶段读取，而管理员Header在后续HTTP hook注入，当前不可触发该类型覆盖；X-Stainless-Retry-Count和X-Stainless-Read-Timeout未改变本地重试/超时/返回类型。复核不据供应商Header重建状态所有权。

原始JSON/重复键/Decimal/引用/Pydantic、接收后大小、全保留字段秘密回显、GEO授权与UNKNOWN不重放边界保持。主代理185项回归、Ruff/mypy/diff及此前PG63passed2deselected为已有证据，独立复核未冒充重跑。未验证真实供应商/生产HTTPS、Browser、完整E2E、真实Redis/Celery、镜像/部署；PG并发/lease/预算复用主代理定向证据。接收期内存上限与旧DNS/IP/peer固定不在本次SDK保证内。

## 审计

Bundle: 20261013T120452Z-psr-003-82c2441e。两阶段WorkPlan与实际dispatch/execution/summary/digest已校验，audit-finalize/audit-verify均passed、closed、无异常。两位代理报告中文，未写文件/执行Git/真实调用；复核期间所有检查的modified/untracked仓库文件SHA不变，未观察到写入。两个复核报告交付验收通过，用户人工接受仍待review。
