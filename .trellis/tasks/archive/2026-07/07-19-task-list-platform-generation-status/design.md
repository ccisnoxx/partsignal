# 技术设计

## 1. 最小可行设计

沿用现有模块化单体、对象存储直传、OpenAPI 生成类型、`StatusTag` 和 `/tasks` 工作台，不新增组件库、上传框架或前端聚合请求。平台资料是品牌展示的唯一可编辑所有者；任务列表是产品、平台和生成状态的只读批量投影。

本任务不拆子任务：数据库字段、OpenAPI、后端投影和两个前端页面存在严格的生成类型依赖，拆分会制造不可独立运行的中间契约。

## 2. 权威数据与边界

```text
平台 Logo 输入
  上传文件 -> FileRecord(VERIFIED, PLATFORM_LOGO, PUBLIC) --┐
                                                            ├-> PlatformProfile 当前品牌资料
  外部 URL -------------------------------------------------┘

任务列表
  ContentTask -> Product
              -> PlatformProfileVersion -> PlatformProfile -> Logo
              -> latest GenerationJob(job_type=GENERATE)
              -> in-flight PublicationRecord -> available_actions
              -> ContentTaskListItem -> /tasks
```

- PostgreSQL 继续持有全部业务状态；Redis 不参与。
- `PlatformProfile` 持有当前 `website_url` 和 Logo 来源。平台名称、Logo、官网变更后，历史任务列表显示当前平台身份；任务锁定的规则版本不变。
- `GenerationJob.status` 是 AI 作业状态唯一来源。列表只读取按 `created_at DESC, id DESC` 排序的最新 `GENERATE`；忽略全部 `HUMANIZE`。
- 产品显示使用 `Product.brand` 与 `Product.part_number`，不新增可编辑的 `product_name` 第二来源。

## 3. 数据模型与迁移

新增 `0020_platform_branding_task_list.py`：

- `platform_profiles.website_url TEXT NULL`
- `platform_profiles.logo_file_id UUID NULL REFERENCES file_records(id) ON DELETE RESTRICT`
- `platform_profiles.logo_external_url TEXT NULL`
- 检查约束：`logo_file_id` 与 `logo_external_url` 至多一个非空。

现有平台三列均保持 `NULL`，不猜测 Logo 或官网。同步运行时 ORM 与 `contracts/database.md`；`backend/app/migration_schema_v1.py` 是 0001–0008 的冻结快照，按数据库规范保持不变。降级前若任一品牌字段非空则拒绝，避免静默丢失已配置资料。

已验证但最终未绑定平台的上传文件暂保留在文件历史中；当前系统没有通用文件删除/垃圾回收命令，本任务不增加第二套清理机制。

## 4. Logo 契约

使用带 `source` 判别字段的强类型联合，外部 URL 与上传文件不能同时存在：

- 输入 `PlatformLogoInput`
  - `{ source: "UPLOAD", file_id: uuid }`
  - `{ source: "EXTERNAL", url: uri }`
- 输出 `PlatformLogo`
  - 上传：`{ source: "UPLOAD", file_id: uuid, url: signed-uri }`
  - 外部：`{ source: "EXTERNAL", url: uri }`

`PlatformProfileCreate.logo` 与 `website_url` 可省略/为 `null`；`PlatformProfileUpdate` 要求显式提交两个可空字段，从而能够清除现有值且不产生“省略是保留还是清空”的兼容分支。`PlatformProfile` 输出始终包含可空 `logo` 与 `website_url`。

上传复用 `/files/upload-intents` 和 `DirectUpload`：

- 新增文件类别 `PLATFORM_LOGO`。
- 最大 2 MiB。
- 接受 PNG、JPEG、WebP、ICO（`image/x-icon`、`image/vnd.microsoft.icon`）；不接受可执行脚本语义更复杂的 SVG。
- 绑定平台前服务端校验文件为 `VERIFIED`、`PUBLIC` 且类别正确。
- 上传 Logo 输出 URL 在读取时由对象存储生成短期签名 URL；数据库只保存 `file_id`，不保存短期 URL。
- 外部 Logo URL 不由服务端抓取，避免 SSRF；前端图片使用 `referrerPolicy="no-referrer"`，加载失败回退到平台名称首字，不伪造第三方商标。

## 5. 内容任务列表契约

保持 `ContentTask` 详情契约不变，新增只用于列表的聚合类型：

- `ContentTaskProductSummary { id, brand, part_number }`
- `ContentTaskPlatformSummary { id, name, website_url, logo }`
- `ContentTaskListItem = ContentTask + { product, platform, latest_generation_status }`
- `latest_generation_status: GenerationJobStatus | null`；`null` 明确表示没有 `GENERATE` 作业。
- `ContentTaskList.items` 改为 `ContentTaskListItem[]`。

这样不会迫使创建、详情、审核或发布接口补充列表专用聚合字段。

## 6. 后端查询与投影

新增列表专用批量投影，不循环调用当前会查询发布状态的 `content_task_out`：

1. 一次读取有序任务。
2. 一次按任务产品 ID 批量读取产品。
3. 一次联结平台规则版本与平台资料。
4. 一次批量读取相关上传 Logo 文件记录。
5. 一次使用 PostgreSQL 窗口函数按任务分组，并以 `created_at DESC, id DESC` 稳定排序读取最新 `GENERATE`。
6. 一次批量读取存在进行中发布记录的任务 ID，计算 `available_actions`。

查询数量只与列表调用相关，不随任务行数增长。缺失受外键保证的产品、平台或 Logo 文件属于数据完整性错误，显式失败，不使用空名称或兼容字段。

平台列表投影继续批量读取 ACTIVE 规则与 Prompt，并增加一次批量 Logo 文件读取；单个平台创建/更新响应可读取一个 Logo 文件。

## 7. 前端行为

### 平台管理

- 创建和编辑表单增加可选平台官网。
- Logo 选择为“无 / 上传文件 / 外部 URL”，三态由一个表单字段拥有；切换来源时清理另一来源。
- 上传复用 `DirectUpload`，仅扩展 `accept` 与提示，不复制上传逻辑。
- 平台列表显示通用头像/真实 Logo、平台名称及可用的官网链接。

### 内容任务列表

表格列调整为：

1. 产品名称：`brand + part_number`，内容角度作为次级截断文本。
2. 目标平台：单个平台 Logo/通用头像和名称；有官网时可安全打开。
3. 任务状态：`OPEN / COMPLETED / CANCELLED`。
4. AI 生成状态：`null / PENDING / RUNNING / SUCCEEDED / FAILED`。
5. 创建时间。
6. 快捷操作：进入任务详情。

搜索额外覆盖产品品牌、型号和平台名称；状态筛选、指标、URL 分页、加载/错误/空状态和创建 Modal 保持现状。`StatusTag` 继续统一枚举标签与色阶：OPEN/RUNNING 为信息蓝，PENDING 为警示橙，COMPLETED/SUCCEEDED 为成功绿，FAILED 为危险红，CANCELLED/无作业为中性灰。

## 8. 安全、兼容与回滚

- 管理员平台创建/编辑权限不变；任务列表读取权限不变。
- URL 使用现有 Pydantic HTTP URL 边界校验；不访问外部 URL 内容。
- Logo 文件必须通过现有哈希、大小、类型和对象完整性校验。
- 不回填、不猜测历史平台品牌资料；历史任务自然获得其平台当前品牌资料。
- OpenAPI 是跨层权威，修改后重新生成前端类型，不手写兼容类型。
- 正常回滚可在尚未写入品牌资料时删除新增列；已有数据时使用向前修复。

## 9. 文档同步

- `contracts/openapi.yaml`：平台品牌、文件类别、列表聚合类型。
- `contracts/database.md`：0020 字段、互斥约束、Logo 文件所有权和列表投影语义。
- `docs/GEO系统前后端技术与部署方案.md`：平台资料和内容任务列表的当前实现关系。
- 若实现未形成新的稳定开发规范，不修改 `.trellis/spec/`。
