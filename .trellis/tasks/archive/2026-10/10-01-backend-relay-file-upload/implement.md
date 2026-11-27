# 实施与证据

2026-10-01 用户授权后端中转上传，并明确本轮不部署。已完成候选源码与前端迁移，无依赖或lockfile变化，无数据库迁移、OSS对象写入、配置安装、服务重载或AI请求。

## 行为

- UploadIntent 返回应用内 PUT 相对路径；客户端只调用 canonical API，携带 Cookie/CSRF、禁止重定向，不向OSS或任意意图URL传递会话令牌。原 signed POST 与上传授权适配器接口删除。
- 后端接收受有效意图、实际大小和120秒上限约束的原始字节；服务器校验SHA-256，实际对象类型使用意图类型。最大EVIDENCE仍为50 MiB。
- 慢网络接收前提交认证事务；结束后刷新/锁定FileRecord并复核创建者、PENDING与expiry，持锁PUT。complete/abort共享行锁，cleanup继续SKIP LOCKED。PUT成功仍PENDING，HEADcomplete才VERIFIED，失败保留明确错误与既有恢复路径。
- 三个入口保留principalcontinuation；GEO和发布证据保留transfer失败abort、complete失败单独重试。Logo保留基线transfer/complete失败均尝试abort的行为，本轮未新增单独complete重试。下载和对象ACL未改。
- 两份候选Nginx站点模板仅在文件路径设置50m body limit；线上模板与Nginx未写入/重载。Production无新任务或操作。

## 定向验证

后端worker执行六个直接相关单元文件：test_file_upload_relay、test_development_storage、test_platform_branding、test_platform_logo_cleanup、test_contract、test_runtime_response_metadata，467 passed。HTTP会话/CSRF/创建者/状态/过期/大小/哈希/分块/超时/50MiB、存储失败、HEADcomplete、abort、清理墓碑与锁SQL结构通过。修改应用文件ruff和mypy通过。

前端worker执行file-transfer与三个入口的四个测试文件，32 passed；改动文件ESLint、typecheck、api:check通过。桌面Playwright fixture五个用例覆盖平台Logo、GEO新建/更正和发布证据，5 passed；Logo用例核对浏览器实际PUT URL、CSRF、Content-Type与原始字节。敏感产物扫描clean。generated types由canonical generator生成。

主代理执行make contract-check：完整runtime/static API契约与generated types一致，164 operations/1039 response occurrences；Nginx项目安全头/HTML/Markdown/DOM sink检查通过，git diff --check通过，已知OSS凭据及高信号secret scan clean。

## 覆盖缺口与运行态

本机Docker daemon不可用，未安装可用PostgreSQL/Redis服务。因此未执行真实PostgreSQL并发交错、完整真实栈E2E或实际OSS验收；数据库/存储替身不能冒充这些证据。未重复运行make verify，原2f171300的完整门禁只属于现在线旧release。

Hostdzire只读快照见evidence/runtime-preservation-before.json：current仍为preview-20260930-111500-2f171300，API/Worker/Scheduler仍openai-compatible+development，active Jobs=0，应用容器、业务数据指纹、fake对象目录、应用Nginx/Compose/release归档与原基线一致，公网root/asset/live/ready200且安全头精确。全局nginx -T摘要与9月30日有变化，应用站点文件和健康均未漂移，未进行任何远端写入。

独立高风险只读复核：NO BLOCKER，仅针对源码+定向验证范围；实际OSS/真实PostgreSQL并发/代理总接收期限、未知远端存储结果与强制进程终止恢复未实测。120秒只从应用读取request stream起算，不宣称约束浏览器到代理的完整链路。真实OSS父任务保持未完成；本轮结束后停止，不创建未来任务。


主代理另将geo-real-stack中的CSRF断言改为布尔比较，避免失败时展开真实令牌；该最小测试修正定向ESLint通过，实际real-stack仍未执行。独立复核后没有产品运行源码变化。


审计Bundle已关闭并验证通过，3次执行均验收通过，1次fresh独立复核，无异常；摘要保存在evidence/SUBAGENT_EXECUTION_DIGEST.*。原检出区HEAD/AGENTS字节与diff SHA、其他worktree保持，见evidence/worktree-preservation.json。用户随后明确授权将本轮完整改动提交并fast-forward推送到origin/main，覆盖此前不提交源码的限制；保持现在线staging release，不部署。提交前重新核对远端仍为9dcbfd81ee42265f4f90c3923975ddba186f795d，diff与secret边界通过后按非强制方式推送；实际提交和推送结果由Git工具确认，不据授权本身声称成功。
