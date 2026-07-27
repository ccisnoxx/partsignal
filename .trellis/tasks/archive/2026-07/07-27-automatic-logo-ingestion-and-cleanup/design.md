# 自动 Logo 导入与资源清理技术设计

## 1. 设计目标

MVP 只解决一个闭环：管理员从平台官网显式请求 Icon Horse 的单一候选，预览并确认后把同一份图片绑定为自有 `logo_file_id`；未采用、被替换或失败的 Logo 按 PostgreSQL 权威引用安全回收。

不实现官网抓取、多候选、自动品牌确认、SVG 转换、哈希去重或通用文件垃圾回收。

## 2. 边界与权威

- `platform_profiles.logo_file_id` 是新 Logo 的唯一可写业务引用。
- `platform_profiles.logo_external_url` 在第一阶段只承载既有只读数据；新请求不能再写入。
- PostgreSQL 保存文件状态、清理截止时间和平台引用；Redis 只负责 Celery Broker，不保存候选或清理状态。
- Icon Horse 只是一次性发现供应商；管理员确认后的展示不再访问 Icon Horse。
- 对象存储只保存不可变字节；新 Logo 使用新 `object_key`，不覆盖旧对象。

## 3. 数据流

```text
平台表单 website_url
  -> POST /api/v1/platform-logo-candidates
  -> 后端提取规范化 hostname
  -> GET https://icon.horse/icon/{hostname}
  -> 限时、限量下载并校验真实图片
  -> PENDING FileRecord + 对象写入 + HEAD 校验
  -> VERIFIED FileRecord(cleanup_after = now + 24h)
  -> 返回 file_id + 签名预览 URL
  -> 管理员选择“使用此 Logo”
  -> 表单暂存 UPLOAD file_id
  -> 既有平台创建/PATCH 原子绑定并清空 cleanup_after
  -> 保存成功后失效平台与内容任务查询
```

预览取消只清除前端本地候选状态，不调用平台创建/PATCH，因此平台 Logo 和 revision 均不变化。候选文件在 24 小时后由清理器处理。

## 4. API 契约

### 4.1 单候选发现

新增管理员、CSRF 保护接口：

```yaml
POST /api/v1/platform-logo-candidates
operationId: createPlatformLogoCandidate

PlatformLogoCandidateCreate:
  required: [website_url]
  properties:
    website_url:
      type: string
      format: uri

PlatformLogoCandidate:
  required: [file_id, preview]
  properties:
    file_id:
      type: string
      format: uuid
    preview:
      $ref: '#/components/schemas/SignedUrl'
```

接口不接收 `platform_profile_id` 或 `expected_revision`，因此创建和编辑表单可以复用，也不会提前修改平台。只有文件已经成为 `VERIFIED`、`PUBLIC`、`PLATFORM_LOGO` 后才返回 `201`。

### 4.2 Logo 写入与读取分离

- `PlatformLogoInput` 只允许 `{source: UPLOAD, file_id}`。
- `PlatformProfileCreate.logo` 可省略；省略或 `null` 表示不设置，`UPLOAD` 表示绑定。
- `PlatformProfileUpdate.logo` 改为可省略的三态字段：
  - 省略：保持当前 `logo_file_id` / `logo_external_url`；
  - `null`：显式清空；
  - `UPLOAD`：绑定自有文件并清空旧外链。
- 服务端用 Pydantic `model_fields_set` 区分省略与显式 `null`，不能用默认值猜测。
- 读取侧 `PlatformLogo` 暂时保留 `UPLOAD | EXTERNAL`，确保旧外链继续展示。

新 API 客户端不能再创建 `EXTERNAL`；旧外链不是可写兼容分支。

### 4.3 错误

| 条件 | HTTP / error_code | 用户结果 |
|---|---|---|
| 官网 URL 或 hostname 无效 | `422 VALIDATION_ERROR` | 修正官网地址 |
| Icon Horse 网络、超时或 5xx | `503 LOGO_DISCOVERY_UNAVAILABLE` | 稍后重试 |
| 3xx、4xx、超限、SVG/HTML、伪造类型或图片无效 | `422 LOGO_CANDIDATE_INVALID` | 明确提示手工上传 |
| 对象存储写入或校验不可用 | `503 DEPENDENCY_UNAVAILABLE` | 稍后重试；残留进入清理 |
| 待绑定文件不是可用平台 Logo | 既有 `FILE_INTEGRITY_FAILED` / `VALIDATION_ERROR` | 不修改平台 |

不使用通用占位图检测哈希或模糊错误兼容；Icon Horse 返回的任何有效位图都只作为待人工确认候选。

## 5. 远端下载与图片验证

- 用 `HttpUrl` 解析平台官网，只使用经过现有 IDNA 规范化规则处理的 `hostname`。
- 上游 origin 固定为 `https://icon.horse`，域名作为经过编码的单一路径段。
- `httpx` 禁止自动重定向并设置连接、读取和总超时。
- 流式读取先检查 `Content-Length`，读取时再次执行 2 MiB 上限。
- 增加 Pillow 依赖，按实际字节验证 PNG、JPEG、WebP、ICO、正尺寸和像素上限；响应 `Content-Type` 只作为早期过滤。
- 不转换图片、不修复损坏文件、不接受 SVG 或 HTML。

固定上游、禁止重定向比允许后端直接抓取任意官网更小，也消除了用户控制目标地址的 SSRF 路径。

## 6. 文件生命周期

### 6.1 Schema

revision `0028_platform_logo_lifecycle` 以 `0027_audit_user_delete_guard` 为前驱，为 `file_records` 增加：

- `cleanup_after TIMESTAMPTZ NULL`
- `deleted_at TIMESTAMPTZ NULL`

状态扩展为：

```text
PENDING -> VERIFIED | FAILED | ABORTED | DELETING
VERIFIED | FAILED | ABORTED -> DELETING
DELETING -> DELETED
```

数据库触发器继续保护对象元数据不可变，并限制上述转换。增加平台 Logo 外键触发器，保证非空 `platform_profiles.logo_file_id` 最终只引用 `VERIFIED`、`PUBLIC`、`PLATFORM_LOGO`。

### 6.2 截止时间

- `PENDING`：`upload_expires_at` 到期即可声明清理。
- `FAILED` / `ABORTED`：下一轮扫描即可声明清理。
- 手工上传完成或 Icon Horse 候选导入成功：`cleanup_after = verified_at + 24h`。
- 任一平台绑定：持有文件行锁后设置 `cleanup_after = NULL`。
- 平台替换、清空或删除后：事务内刷新引用；旧文件解除最后引用时设置 `cleanup_after = now + 7d`。
- `DELETING`：每轮重试，直到对象存储明确删除或确认不存在。

迁移无法知道既有未引用 Logo 的真实解绑时间；统一设置为迁移时点后 7 天。已引用 Logo 保持 `cleanup_after=NULL`，其他文件类别不参与本任务清理。

### 6.3 引用权威与锁

- 不增加 `reference_count`。
- 清理前实时检查当前 head 中 `platform_profiles`、`publication_attachments`、`geo_observation_attachments` 的全部实际文件外键；`evidences` 已由 revision `0025` 删除，不得查询或恢复兼容分支。
- 平台绑定与清理都锁同一 `FileRecord`；旧、新文件同时参与时按 UUID 稳定顺序锁定。
- 清理器用有限批次和 `FOR UPDATE SKIP LOCKED` 选择到期行。
- 有引用时不改状态，并清除错误的 `cleanup_after`；无引用时先提交 `DELETING`，再执行对象删除。
- 对象删除成功后转为 `DELETED` 并设置 `deleted_at`；失败保留 `DELETING`。

`cleanup_after` 只是调度提示，外键实时查询才是删除权威。

## 7. 对象存储

扩展既有 `EvidenceStorage`，不引入第二个存储客户端：

```text
put(object_key, data, content_type, sha256)
delete(object_key)
```

- 开发存储增加复用现有签名协议的内部 PUT 与 DELETE；删除同时处理对象和 metadata 文件。
- OSS 适配器使用现有 SDK 的 `put_object` / `delete_object`。
- `delete` 幂等：对象不存在视为成功；鉴权、网络或服务端错误映射为 `StorageUnavailable`。

候选导入先提交 `PENDING FileRecord`，再写对象并校验。这样对象写入后即使请求事务失败，仍有可重试、可清理的数据库记录。

## 8. 清理执行

复用现有 Celery Worker 与 Beat：

- 增加 `partsignal.cleanup_platform_logo_files` 周期任务；
- 小批次、小时级扫描即可满足 24 小时和 7 天窗口；
- 每轮结果用中文结构化日志记录 selected、deleted、retry、failed 和非敏感 file_id；
- 后台任务没有真实用户 actor，不伪造审计记录。

管理员发起候选导入时写真实审计，记录 provider、规范化域名、格式、大小和成功/失败，不保存响应正文。

## 9. 前端

继续使用平台创建/编辑 Modal，不增加页面或全局 Store：

1. 旧 `EXTERNAL` Logo 继续用 `PlatformAvatar` 展示，并标注“旧外链 Logo（只读）”。
2. Logo 操作只保留“从官网发现”“手工上传”“清空”。
3. “从官网发现”调用候选端点；成功后显示一张预览及“使用此 Logo”“取消”。
4. “使用此 Logo”只把候选 `file_id` 写入表单待提交状态，并提示“保存平台后生效”。
5. 编辑旧外链平台的其他字段时省略 `logo`；只有清空或替换才发送该字段。
6. 保存成功统一失效：
   - `queryKeys.platformProfiles.all`
   - `queryKeys.platformProfiles.detail(saved.id)`
   - `queryKeys.contentTasks.all`

不修改 `PlatformAvatar` 的数据所有权，不增加事件总线、全局版本或第二套 Avatar。

## 10. 两阶段退出旧外链

本阶段：

- 禁止新 `EXTERNAL` 写入；
- 保留旧列、读取投影和展示；
- 管理员逐个使用预览确认或手工上传转换；
- 数据库迁移和后台任务不联网批量转换。

后续独立变更仅在所有环境 `logo_external_url IS NOT NULL` 计数为零后，删除列、输出联合中的 `EXTERNAL` 和只读分支。本任务不提前创建兼容迁移脚本。

## 11. 回滚

- 新 revision downgrade 在存在 `DELETING` 或 `DELETED` 文件时明确拒绝；对象删除不可逆，必须前滚修复或恢复备份。
- 尚未执行删除时可恢复旧触发器并删除新增字段；既有外链列从未移除。
- 候选导入失败不修改平台；平台 PATCH revision 冲突也不会误绑候选，候选按 24 小时策略回收。
- 清理器可以通过停止 Beat 任务阻止新的删除声明；已经是 `DELETING` 的对象继续需要前滚处理。

## 12. 复杂度取舍

- 增加 Pillow 是为了正确验证不可信图片，避免维护四种手写格式解析器。
- 增加 `cleanup_after` 是表达“最后解绑后 7 天”的最小状态；仅凭 `created_at` 会立即删除长期使用后刚解绑的旧 Logo。
- 保留 `DELETED` 文件记录而不是物理删除数据库行，保证删除可重试、审计 ID 可解释；数据库墓碑清理不属于 MVP。
- 自动导入与清理共享同一文件生命周期，拆成独立实现会产生两套未引用资源规则，因此当前任务保持一个集成交付，不拆子任务。
