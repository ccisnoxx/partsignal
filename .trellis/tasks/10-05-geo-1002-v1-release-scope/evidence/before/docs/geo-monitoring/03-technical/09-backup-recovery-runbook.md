# GEO-903 一致性集合与隔离恢复 Runbook

当前交付：核心数据库/对象/密钥备份与一次性恢复验证。工具不发布生产、不替换主库，不启动 API、Worker、Beat 或 Browser。当前 schema 为 `0065_geo_observability`，没有本任务迁移。生产安全与启用验收仍由 GEO-904/906 在目标环境完成。

## 备份清单

| 资产 | 权威与备份方式 | 恢复验证 |
| --- | --- | --- |
| 全部 PostgreSQL public 表、约束、触发器、函数、索引和迁移版本 | `pg_dump` custom；与库存共享导出的只读 RR snapshot | `pg_restore` 导出SQL、`psql --single-transaction --set=ON_ERROR_STOP=1`；每表完整行数量与 SHA-256、结构清单；head 不漂移 |
| 已验证文件、GEO screenshot/raw 及其他 FileRecord 对象 | 通过既有存储适配器签署短期 GET，实际读取字节，核对 PG size/SHA-256 | 恢复至单次临时开发对象树，保持 object_key/metadata，核对实际字节；缺失不造内容 |
| `AI_CREDENTIAL_ENCRYPTION_KEY` | 受保护 secrets JSON，与数据库配对后再加密 | 逐一通过 CredentialCipher 的真实记录 AAD 解密 channel API key 与 sensitive Header；明文不输出 |
| `SESSION_SECRET` | 同 secrets JSON；与 session/CSRF 哈希配套 | 备份与当前Settings恒时配对；恢复实际使用包内值校验已恢复的token摘要。恢复后已有登录是否保留由部署负责人决定。改变它会使既有 token/CSRF 摘要失效，不能误认为恢复损坏 |
| `UPLOAD_SIGNING_SECRET` | 同 secrets JSON；Aliyun OSS 不使用开发签名，仍保留既有配置身份 | 备份核对来源配置；本地对象恢复实际使用包内密钥签名；临时下载 URL 重新签发，不作为业务恢复摘要 |
| release manifest、生产 runtime env、当前 Nginx 项目配置 | 加密 artifact；生产来源必须提供 runtime/env 和 Nginx 配置 | 解密认证和摘要；不执行 env、不安装配置、不 reload Nginx |
| Redis/beat 文件 | 不作为业务状态备份；恢复不导入 | 由 PG 批次身份、attempt、lease、发送账本补偿；不重放旧 broker 消息 |
| Browser 密文卷、RSA 私钥/公钥、能力文件、PG 会话引用 | 只有未部署且确认无材料才 N/A；有材料走下述专用流程 | 不以延期豁免，不能使用核心工具产生 N/A |
| 独立 backup encryption key | Base64 32 随机字节；0400/0600，分开保管 | AES-256-GCM 认证全部文件；该 key 从不写入集合；丢失即无法解密 |

备份密钥不是 AI 主密钥。集合内 dump、秘密清单、对象、release/runtime/Nginx 和 manifest 全部认证加密，AAD 绑定集合 UUID 与逻辑文件名。目录0700，文件0600；`READY`仅代表集合完成写入，**不代表 complete=true**。缺失/损坏对象可以保留不完整集合用于调查，但命令必须非零。没有 READY 的部分集合不用于恢复。源秘密、临时明文和dump不得提交 Git、写入Trellis/普通日志或共享报告。

## 备份前的一致性窗口

1. 数据负责人/运维确定环境、保留期限与受保护异地存储位置。备份生产读权限不等于生产恢复权限。
2. 根据部署当前 owner/runbook 进入维护窗口，暂停所有 API 写入口、Worker、Scheduler、人工录入和文件/retention清理；等待在途上传/提交/外部请求结束或记录其确定/未知结果。不要直接批量修改 Run 状态。
3. 查当前部署的实际 Browser 服务/profile/挂载和卷，检查所有配置/遗留材料位置。不得仅检查仓库默认值。JSON部署证据须包含以下字段，检查时间距备份不超过1小时：

```json
{
  "environment": "本次实际检查的环境标识",
  "checked_at": "具有时区的实际检查时间",
  "r7_deployed": false,
  "browser_service_running": false,
  "session_mounts_present": false,
  "material_roots": [],
  "quiesced": true
}
```

`material_roots`列出本环境所有适用会话/临时材料目录。无部署、无配置且确认没有这类目录时才为空；已有目录必须实际扫描，缺失/无法读取的声明路径不能当作零材料。部署/静默字段是负责人的现场检查记录，工具不能从它们推断未经检查的另一环境事实；工具另验证当前 Settings、PG会话行数和枚举目录。false/0组合才允许N/A；已有撤销/过期PG行也不能N/A。

4. 从现有受保护配置准备0600 `RECOVERY_SECRETS_FILE`，只含三个字符串键（SESSION_SECRET至少32字符），工具须与本次来源Settings逐项恒时配对：`AI_CREDENTIAL_ENCRYPTION_KEY`、`SESSION_SECRET`、`UPLOAD_SIGNING_SECRET`。不要把它们写进命令行、history、报告或样例。AI渠道明文API key不需要导出，仍在数据库中保持密文。
5. `RECOVERY_RELEASE_MANIFEST`指向来源实际release文件；production另提供0600 `RECOVERY_RUNTIME_ENV_FILE`和`RECOVERY_NGINX_CONFIG_FILE`。这些文件从头至尾只被读取和加密，恢复不执行其内容。
6. PostgreSQL客户端安装在运维环境，`RECOVERY_PG_BIN`指向含pg_dump/pg_restore/psql的目录。应用依赖没有变更。来源与恢复环境使用同一受支持PG主版本/locale、同一release及配置；连接选项不被工具猜测或降级。数据库I/O前拒绝继承PGHOSTADDR、PGSERVICE及其他PG*覆盖，来源/恢复URL须有显式host且无query/fragment；TLS配置必须由既有运维环境建立，工具不接受query绕过。保持网络/TLS边界，工具不提供跳过证书检查选项。

## 执行核心备份

从仓库根、已配置业务只读来源的受保护操作会话执行。`DATABASE_URL`是来源；变量只携带文件路径时可直接设置，不回显密钥或URL。

```bash
BACKUP_DIR=/secure/geo-backups \
RECOVERY_BACKUP_KEY_FILE=/secure/geo-backup.key \
RECOVERY_SECRETS_FILE=/secure/geo-secrets.json \
RECOVERY_DEPLOYMENT_EVIDENCE=/secure/deployment-check.json \
RECOVERY_RELEASE_MANIFEST=/secure/release-manifest.json \
RECOVERY_RUNTIME_ENV_FILE=/secure/runtime.env \
RECOVERY_NGINX_CONFIG_FILE=/secure/nginx-project.conf \
deploy/scripts/backup.sh
```

也可用`backend/.venv/bin/python deploy/scripts/geo-recovery.py backup <新集合目录>`，指定同名`--backup-key-file`、`--secrets-file`、`--deployment-evidence`、`--release-manifest`及生产两个可选文件参数；设置`PYTHONPATH=backend`。目标目录必须不存在，禁止覆盖旧集合。旧的仅SQL gzip不满足GEO一致性集合，不经本工具导入；原始文件继续按受保护历史保留。

成功要求JSON `complete=true`和退出0。缺失对象返回稳定file UUID与MISSING；损坏CORRUPT；鉴权/网络UNAVAILABLE。不输出object_key、签名URL、DSN、正文或密文。保留来源库、Run、文件hash和引用，不删除记录掩盖缺失。故障后排查其来源/存储生命周期，取得实际对象版本才可重新备份；不得补造对象。

将加密集合复制到已批准的受保护异地位置，核验复制后的密文字节摘要并做隔离恢复；密钥走独立备份通道。异地复制、保留策略与保管负责人必须有环境记录，本地演练不宣称其已部署。

## 一次性隔离恢复

1. 准备本机独立PG演练实例或专属隔离PG服务，回环管理连接放入`RECOVERY_ADMIN_DATABASE_URL`。生产主库不能作为目标；脚本不接受目标业务库URL或`VERIFY_DATABASE_URL`。
2. 同release源码和受保护配置下执行：

```bash
deploy/scripts/restore-verify.sh /secure/geo-backups/<本次集合目录>
```

脚本先认证/解密所有artifact并核对摘要，再创建`partsignal_e2e_<date>_<random32>`，写入随机owner comment并确认public空库，才导出恢复SQL并在单事务中执行。不允许`--create`、`--clean`、任意现成target或SQL gzip管道。目标对象仅在本次私有临时目录；从不对生产OSS执行PUT/DELETE。

既有SQL-string哈希函数会在pg_restore空search_path下内联失败。工具只在已验证owner+空库内，将导出SQL唯一精确的空search_path语句改为pg_catalog,public，其余SQL保持；没有修改函数或禁用触发器/约束。匹配计数异常即停止。此恢复边界以当前PG16/release验证；版本/导出格式变化须重新验证。

3. 比较每表完整摘要、migration head、约束/索引归属及属性清单、逐字函数/触发器定义与启用属性、逐条凭据解密、每个Run Detail、Overview业务/质量指标语义摘要。摘要仅排除`as_of`和临时`download` capability；revision、原文hash、attempt、分析/复核与指标分子/分母/公式版本必须一致。对象还原到本次开发树后逐个核对真实字节与metadata。
结构清单不是CHECK表达式的通用语义证明：PG dump/reparse会改变等价cast/括号表示，导入保持认证原始DDL；真实隔离验收另验证Answer同值UPDATE触发23514 ck_geo_answers_immutable及调度窗口去重。

4. 结果`complete=true`、`mismatched_sections=[]`及退出0才通过。正常、异常及受控SIGTERM/SIGINT均关闭连接，核对owner后drop本次随机库，移除临时对象/明文目录。清理失败必须非零，不把残留环境当通过；根据数据库精确名称和owner记录人工调查，不能通配drop/清理。
5. 该工具是销毁式**演练环境生命周期**，不会留下可发布的恢复站点。实际灾难切换需另行授权、环境所有权核对和外部服务门禁，不能用本次测试发布生产。

## 调度、未终态与发送账本处置

| 恢复状态 | 处置 |
| --- | --- |
| MANUAL PENDING/草稿 | 保持原Run和draft_revision；不触发外部调用；由原业务入口显式继续/取消 |
| API PENDING、NOT_STARTED、无Answer | 隔离演练只读；获准实际恢复后由既有扫描补投递稳定UUID，重复消费者仍由claim锁/token仲裁 |
| RUNNING、NOT_STARTED、租约过期且无Answer | 按现有GEO-406 recovery锁内撤销旧token；满足完整条件才恢复PENDING |
| RUNNING、SENT/UNKNOWN | 不重发、不清发送账本；既有recovery按未知结果终止，显式新attempt才可再次采集 |
| ANALYZING/重分析租约 | 先保留Answer和current选择，再按现有分析恢复服务处理；不重新采集 |
| COMPLETED/FAILED/CANCELLED/BUDGET_BLOCKED | 保持不可变；迟到结果不覆盖 |
| 已有plan/window | `create_scheduled_batch`按(plan_id,scheduled_for)返回旧回执，唯一约束不包含plan revision；重复/并发不会新建旧窗口 |

不新增生产cron接线，不凭backup去追补全部错过的时间窗口。恢复演练测试实际调用现有工厂验证同窗口并发回放且恰好一条batch，并比对完整DB摘要。生产放开任何consumer前须处理源系统是否仍在运行、备份之后已发送请求是否可确认：备份点之后的外发不在dump中，不能仅凭旧NOT_STARTED保证真实平台未接收。结果不明时保持停止并人工对账，不盲目自动发出。

## Browser 条件分支

ADR-006使804～807延期，不免除已有材料。核心工具检测到部署/配置/挂载/PG引用/目录材料时输出`BROWSER_RECOVERY_REQUIRED`并非零，没有N/A集合。

适用时，受保护备份还必须收集：全部PG会话/撤销记录、独立密文卷及未引用临时文件清单、对应RSA私钥/公钥、能力文件和key身份；同一静默窗口核对每个cipher_sha256。私钥/能力文件单独受控加密保管，不能并入普通OSS/Web根或普通诊断日志。保持原权限和owner，已有expired/revoked资料不因恢复复活。

在**另一隔离会话卷**恢复后，按GEO-802相同包络/摘要/AAD校验与现有受控Collector解密入口验证虚构或获准的资料；不测试真实登录、不调用真实平台。备份前已撤销的UUID仍不可访问；撤销后的删除失败仍保持墓碑并按PURGE重试。演练新增的有效会话必须用现有ADMIN+CSRF+revision命令显式REVOKE/PURGE，保留审计、确认内部读取拒绝和密文已移除；数据库记录不删除、不手工改revoked_at。没有适用私钥或该分支实际恢复/撤销证据时，该环境的GEO-903不能宣称通过，需补齐授权输入。

本轮本机开发和新建测试来源没有R7部署或Browser材料，依据见Task evidence；不推广为生产N/A。GEO-904/906仍须在其目标环境核实开关false、服务/profile未启用和无生产会话/会话材料。


## 可重复的本地演练

在独立开发PG16容器已启动、测试来源连接已在受保护环境中提供后：

```bash
GEO_RECOVERY_PG_CONTAINER=partsignal-dev-postgres-1 \
REDIS_URL=redis://127.0.0.1:56379/14 \
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_geo_recovery_boundaries.py \
  backend/tests/integration/test_geo_recovery.py
```

`PARTSIGNAL_TEST_DATABASE_URL`使用环境中的回环测试管理连接，不在文档内填写秘密。测试对照容器映射端口，只允许工具访问partsignal_geo903_source_/partsignal_e2e_专属库；或显式`RECOVERY_PG_BIN`使用同版本本机工具。不会skip真实恢复后冒充成功。来源库由测试创建并前滚至0065，对象服务只监听随机回环端口，材料都是虚构资料。每个场景结束精确清理其来源库、恢复库、临时密钥、加密集合和对象树。

自动清理覆盖正常退出、Python异常、SIGINT/SIGTERM；SIGKILL、断电或集群不可用无法运行finally，必须依据精确随机数据库名与owner marker现场核查，禁止通配删除。owner未提交/不匹配时工具不会越权drop，返回明确cleanup失败及低敏数据库名，保持安全停止。

对象库存采用保守完整性门禁：除DELETED墓碑外均需实际对象与声明hash/size一致；未完成上传或其他生命周期对象缺失也明确MISSING，不生成字节或自动将其排除为成功。查明实际生命周期后按既有业务入口处理，再取新一致性集合。
