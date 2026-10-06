# GEO-802 实现设计

## 状态所有权与边界

PostgreSQL geo_browser_sessions 仅保存引用/摘要/人工期限/健康/撤销/清理事实。Application Service 拥有当前管理员权限、Profile CAS 和聚合事务；Router 只映射协议。根 OpenAPI/database 为公开与持久化权威；前端使用生成类型与 available_actions，不拥有第二套状态机。browser-session 登记只允许建立管理配置：零采集能力、未批准、不支持连接测试，不能启用采集或生成 PASSED。

## 密文与消费者

API 持 RSA >=3072 公钥，AES-256-GCM 独立随机密钥/nonce，并以 RSA-OAEP-SHA256 包装密钥。v1 AAD 绑定 UUID reference/Profile/人工期限；Envelope 外内期限必须同为 UTC 六位微秒 +00:00。闭合 storage state 只接受 Surface HTTPS origin/domain，128KiB 上限，最长30日且不超过持久 Cookie 到期；JSON重复键/非有限数/多余键明确失败。Secrets 用 writeOnly SecretStr，错误不回显值。

受保护目录逐级 nofollow，以目录 fd 锚定；密文0600、随机 staging、非覆盖发布、文件/目录 fsync。卷不挂普通OSS。Collector 仅持私钥/专用服务能力文件，无卷读取能力；每次 withAuthorizedSession 调用授权回调获取密文，在内存解密并 finally 清理 Buffer/state 引用。consumer 负责关闭临时 BrowserContext；无真实平台接线。默认 network none/STOP/两个业务开关关闭。

## 事务、锁与失败

复用 User当前身份 → UUID Channel/Model（如有）→ Surface → Profile → UUID session 锁序；管理命令携带 expected_revision。新增内部 session_revision 每次会话事实变化加一，同时推进公开 Profile revision，复用既有父修订守卫。过期/坏卷/导入/撤销清除当前测试事实并停用。

导入先持久化随机密文，再同事务撤销旧引用、建立新引用、失效 Profile 并审计，提交后清理旧材料。DB/卷无共同事务，失败或崩溃可留下不可通过API读取的加密孤儿；不猜测提交结果或删除可能已发布对象。撤销先提交不可逆墓碑及审计，后删文件。删除失败返回真实 cleanup_pending_count/PURGE；PURGE只删已撤销引用，缺文件幂等成功，审计失败不写清理成功。不可DELETE/TRUNCATE或复活历史，downgrade拒绝破坏性删除。

内部 access 仅专用 X-GEO-Browser-Service-Key（文件、constant-time比较），绑定现有启用 ADMIN；每次锁内重新校验当前身份、Surface合规/活动、Profile归属/活动/登录态、两个开关、引用撤销/过期、密文哈希。访问审计提交后才返回 no-store 密文。撤销先拿锁则拒绝释放；已经返回的内存无法追回，后续804须独立建立 Run SEND 授权。本任务没有Redis新payload或真实出网。

## UI 与恢复

复用配置详情与 profile_id URL 状态；独立 context query key 和精确 Profile/detail/list invalidation。File保留于ref，秘密仅存在当前 await 请求，不进入 mutation/query cache、DOM预览或持久存储；权限epoch/取消/过期响应/重复提交受控。409显式刷新并重新确认，不重放秘密。恢复是新导入/新UUID，旧引用永久撤销。health AVAILABLE仅为本地完整性及人工期限；login_probe=NOT_IMPLEMENTED。

## 迁移与验证

0063_geo_browser_sessions → 0062_geo_opportunity_decisions；加法表/默认0计数/约束/守卫，不回填历史。先迁移再部署；安全停止关闭入口、保留墓碑，恢复为备份或前向修复。空库及非空0062前滚/数据保留/ORM合同/拒绝downgrade已实测。

验证及独立复核事实见 implement.md 与 evidence/independent-review.md；生产密钥、真实平台、在线登录探测、真实发送/截图、自动保留与灾难恢复没有在本任务实施。
