# PSR-001 独立复核与修复

首轮 fresh critical_reviewer 只读检查公开 SDK API、凭据/环境/Header、错误映射、revision/锁/事务和已知调用者，使用虚构数据与 MockTransport 作短复现，没有运行真实 Provider、PostgreSQL、pytest 或镜像。

## 首轮确认问题

1. P1：OpenAI 3.29.0 自动合并 `OPENAI_CUSTOM_HEADERS`，数据库外的敏感 Header/Host/Content-Type 可以进入外发请求。修复为非空进程配置在零发送边界返回固定 `INVALID_HEADER`，不修改全局 os.environ。GET/POST 反例验证零发送；正常管理员 Header、Host 和 JSON Content-Type 继续验证。
2. P2：新 ASCII-only 校验收窄旧 Latin-1 API Key 范围。删除 ASCII 限制，保留既有控制字符及 >255 拒绝；SDK 默认 Authorization 设为空，由已存在的公开 Latin-1 Header hook 在发送前设为真实凭据。GET/POST 实际 SDK 回归验证字节和值，未调用私有 API。
3. P2：非法 UTF-8 响应的 UnicodeDecodeError 未映射，可能跳过失败/停用回写。固定映射 `AI_RESPONSE_INVALID`，不透传正文；SDK 单元及本机 HTTP/PostgreSQL 测试覆盖启用模型变为 FAILED/停用/revision+1、发现安全 502，以及在途 revision 冲突优先。

未将本任务明确授权的 DNS/IP/peer 与响应字节上限移除当作缺陷。其余同步公开 API、max_retries=0、禁止重定向/环境代理、CredentialCipher、事务外 I/O、expire_all、锁序、revision、Bootstrap T1/T2/T3 与旧生成/GEO 调用边界未发现确认问题。

首轮报告作为可行动复核交付验收通过，不表示当时的代码候选无阻断。修复后的候选另做 fresh 定向复核，避免用实现者自查替代独立审查。子代理执行证据在审计 Bundle `20261013T053328Z-psr-001-9b336639`；正式 digest 生成后补记录验证状态。

## 修复候选最终独立复核

第二位 fresh critical_reviewer 未发现剩余确认问题，三项阻断具备解除依据。独立执行两段无落盘、隔离环境的 python -B 短复现，14个 MockTransport 场景 exit0：非空环境 Header 在 SDK 创建/请求前零发送且环境未变；Latin-1 Key 的0x80–0xFF范围与普通 Header、Host、JSON Content-Type正确，控制字符/DEL/>255在发送前失败；非法 UTF-8 的200响应安全映射502、429保留供应商错误分类，无正文泄漏/重试。公开客户端释放路径有效；首次临时断言错误要求 transport只关闭一次，经检查双context后改为验证实际资源释放，未形成确认业务缺陷。范围内 git diff --check exit0。

静态追踪确认错误继续由既有 service按锁序与双revision复核回写，漂移优先冲突，无漂移FAILED/停用/revision+1。独立审查复用了主代理提供的精确58单元、11集成、Ruff和mypy结束输出，没有独立重跑PG/Bootstrap/真实Provider/镜像/完整E2E，其余15条旧管理测试未逐条复核。第二轮期间全部当前modified/untracked仓库文件SHA逐项未变化，未观察到子代理写入。

最终 SUBAGENT_EXECUTION_DIGEST 已生成，audit-finalize/audit-verify均passed，closed，2次实际派发、2项复核报告验收、2次独立复核，无异常、无残留活跃代理，未观察到写入。模型/推理档位仅为Agent TOML配置证据，不作为运行时遥测。
