# GEO-401 设计：内部采集合同

状态：review；实现范围为协议、值对象与稳定错误，不实现 transport 或 Worker。

## 状态与边界所有权

- Registry 的 `CollectorRegistration` 唯一拥有 adapter key/version/模式/六项 capability，
  Protocol 复用其 Profile 校验。当前执行资格仍由 Application Service 裁决。
- `CollectionRequest.from_snapshot` 将已校验的公开冻结 DTO 显式复制为内部不可变值。
  请求保留原问题、数据分级、冻结 Profile/Surface 与调用限额；不传 ORM Session、
  凭据、subject/别名字典或事实正文，避免将分析上下文污染监测问题。
- `CollectedAnswer` 只拥有原始结果与已报告元数据。未知值为 None；不推算 usage/cost，
  不计算指标或解释引用归属。引用保留原 URL 与不同实际位置，提交边界负责规范去重。
- 值对象校验已知大小/数值/字符串/摘要规则；无效来源和含 NUL 的标题显式失败。
  bytes 的脱敏、截图裁剪、传输限额与资源释放必须由实际 adapter 执行，结构校验不能
  证明这些运行行为。文件资格与回答聚合提交由 Application Service 拥有。

## 发送与恢复合同

`collect(request, *, before_send)` 必须由调用者提供 `SendAuthorization`。
未来 Worker 在短事务内验证当前资格、lease/token 和业务状态，并原子保存 SENT；
Collector 在首次请求字节前恰好调用该回调，失败不能发送。每次 collect 至多发送一个
业务请求，禁止发送后 retry/redirect/切换地址。即使回调后尚未发出字节，数据库 SENT
仍保守恢复，不能由 Collector 的 NOT_STARTED 单独撤销持久化标记。

`CollectorError.failure` 为不可变稳定字段集合，必须显式提供发送状态。
细阶段配置/连接必须 NOT_STARTED，解析/证据必须 COMPLETED，接收不能 NOT_STARTED。
UNKNOWN_OUTCOME 只允许 SENT/UNKNOWN。只有确证 NOT_STARTED 的 CONNECT/SEND 暂态
超时或不可用错误标记 SAFE_BEFORE_SEND；该分类不授予重发权限。配置/认证/合规等错误
为 NOT_RETRYABLE，其他已发送失败只允许后续显式 NEW_ATTEMPT_ONLY。完整 429 的
retry-after 仅为新 attempt 元数据。COMPLETED 表示外部响应结束，不表示业务提交成功。

错误码复用 Run 的 Collector 子集，全部映射到 COLLECTION；Worker/预算/分析/复核
错误由各自 owner 维护。静态中文 message 不接受底层异常、响应正文或任意供应商文本。

## 兼容与迁移

同步结构 Protocol 无生产实现、factory 或网络客户端。默认 Registry 仍只有 manual
元数据；不新增 fake provider、API/BROWSER adapter、队列 payload 或开关行为。
OpenAPI、数据库与 Alembic 无变化，head 保持 0051_geo_manual_collection。
不新增锁、事务、revision、状态转换或幂等键。后续 GEO-404/405/406 应在真实边界验证
发送计数、持久化标记、lease 竞争和迟到结果，不能依据本任务的签名测试宣称已完成。

## 验证与复核

抽象合同测试验证冻结值、DTO 转换、未知元数据、证据约束、稳定错误及无 ORM 依赖。
独立只读复核发现来源空白和 NUL 缺口，主代理增加 13 项先失败后通过的回归并修正。
精确命令、门禁、原始报告与剩余运行覆盖见 [实施证据](implement.md)。
