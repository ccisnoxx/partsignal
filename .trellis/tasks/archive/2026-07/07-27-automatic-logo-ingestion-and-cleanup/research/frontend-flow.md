# Research: 前端 Logo 表单、API 与缓存数据流

- Query: 追踪平台创建/编辑 Logo 来源表单、`DirectUpload`、`PlatformAvatar`、React Query keys/invalidation、所有平台 Logo 展示位置、OpenAPI 生成类型与测试，并提出满足单候选预览确认、取消不改 revision、旧 `EXTERNAL` 只读、保存后全局刷新的最小 MVP 形状。
- Scope: internal；Icon Horse 行为仅采用当前任务 PRD 已确认事实，未重复联网验证。
- Date: 2026-07-27

## Findings

### 结论

最小 MVP 不需要新页面、全局 Store、候选列表或第二套上传组件。保留现有平台创建/编辑 Modal，在 `PlatformBrandingFields` 内增加一个页面本地候选状态；服务端发现并暂存一张候选，前端只预览这一张，管理员点击“使用此 Logo”时仅把候选 `file_id` 写入当前表单，最终仍由既有创建/保存动作原子绑定。这样取消候选不会调用平台写接口，也不会改变 `revision`。

契约必须把 Logo 的写入类型与读取投影拆开：新请求只允许 `UPLOAD`，读取投影继续保留 `EXTERNAL`；同时 `PlatformProfileUpdate.logo` 必须变为可省略，明确规定“省略=保持、`null`=清空、`UPLOAD`=替换”。否则旧外链平台编辑名称等无关字段时，现有必填 `logo` 会迫使前端重新提交已禁用的 `EXTERNAL`，或错误清空旧值。

保存后的最小缓存修复是统一失效三组查询：

1. `queryKeys.platformProfiles.all`：覆盖平台管理列表、Prompt 平台列表、设置页与任务创建平台选项；
2. `queryKeys.platformProfiles.detail(saved.id)`：覆盖管理详情和 Prompt 选中平台详情；
3. `queryKeys.contentTasks.all`：覆盖独立返回当前平台名称、官网和 Logo 的内容任务列表。

### Files Found

| 文件 | 说明 |
|---|---|
| `frontend/src/features/configuration/PlatformsPage.tsx` | 平台创建/编辑表单、Logo 来源选择、平台 mutation 与当前失效逻辑。 |
| `frontend/src/shared/components/DirectUpload.tsx` | 浏览器直传对象存储、完整性确认和失败重试的共享组件。 |
| `frontend/src/shared/components/PlatformAvatar.tsx` | 平台 Logo 的唯一共享渲染边界。 |
| `frontend/src/shared/api/queryKeys.ts` | React Query key 唯一注册表。 |
| `frontend/src/shared/api/queryOptions.ts` | 平台列表/详情查询定义与 stale time。 |
| `frontend/src/app/queryClient.ts` | 全局 stale time 与 mutation/query 默认策略。 |
| `frontend/src/features/configuration/PlatformDetailPanel.tsx` | 平台详情 Logo 消费者。 |
| `frontend/src/features/configuration/PlatformPromptsPage.tsx` | Prompt 平台列表 Logo 消费者。 |
| `frontend/src/features/content-tasks/ContentTasksPage.tsx` | 独立内容任务列表 Logo 消费者与任务创建平台查询。 |
| `frontend/src/features/settings/SettingsPage.tsx` | 消费平台列表作为账号表单/筛选数据，但不渲染 Logo。 |
| `frontend/src/shared/api/schema.d.ts` | 从 OpenAPI 生成的请求、响应和 path 类型。 |
| `frontend/src/shared/api/types.ts` | 仅为生成 Schema/paths 提供别名，没有第二套 DTO。 |
| `frontend/scripts/check-openapi.mjs` | 临时重新生成类型并逐字比较，防止生成产物漂移。 |
| `frontend/src/features/configuration/ConfigurationPages.test.tsx` | 当前平台表单、外链 Logo 和 Logo 尺寸的主要前端测试。 |
| `frontend/src/features/content-tasks/ContentTasksPage.test.tsx` | 当前内容任务 Logo 数据固定为 `null`，未覆盖刷新。 |
| `contracts/openapi.yaml` | 当前平台、Logo、上传意图和内容任务摘要的权威 API 契约。 |
| `backend/app/schemas/configuration.py` | 当前运行时 Logo 判别联合与平台创建/更新 Schema。 |
| `backend/app/services/platform_configuration.py` | 当前 PATCH 每次覆盖 Logo 并递增 revision。 |
| `backend/app/services/projections.py` | 平台列表/详情与内容任务列表的 Logo 投影共同所有者。 |
| `backend/tests/unit/test_platform_branding.py` | 当前上传 Logo 文件约束、外链写入和输入联合测试。 |

### 当前写入数据流

#### 创建/编辑表单

- 页面本地定义 `PlatformLogoSource = 'NONE' | 'UPLOAD' | 'EXTERNAL'`，`platformLogoInput` 将 `NONE` 转成 `null`、`EXTERNAL` 转成 `{source, url}`、`UPLOAD` 转成 `{source, file_id}`（`frontend/src/features/configuration/PlatformsPage.tsx:59`、`frontend/src/features/configuration/PlatformsPage.tsx:96`）。
- 创建表单默认 `logo_source: 'NONE'`，提交时总是构造 `logo`；编辑表单按读取投影恢复 `EXTERNAL` URL 或 `UPLOAD` file ID，并总是向 PATCH 提交 `logo`（`frontend/src/features/configuration/PlatformsPage.tsx:388`、`frontend/src/features/configuration/PlatformsPage.tsx:392`）。
- `PlatformBrandingFields` 当前提供“不设置 / 上传 / 外链”三个可写选项；切换来源会清除另一来源字段。上传成功只把已校验文件 ID 写入隐藏字段（`frontend/src/features/configuration/PlatformsPage.tsx:397`、`frontend/src/features/configuration/PlatformsPage.tsx:403`、`frontend/src/features/configuration/PlatformsPage.tsx:407`）。
- 当前 PATCH 运行时 Schema 要求 `logo` 必传（`backend/app/schemas/configuration.py:131`）；服务层无条件调用 `platform_logo_storage_values(payload.logo)`，随后同时覆盖 `logo_file_id` 与 `logo_external_url`，最后递增 revision（`backend/app/services/platform_configuration.py:559`、`backend/app/services/platform_configuration.py:583`、`backend/app/services/platform_configuration.py:588`、`backend/app/services/platform_configuration.py:590`）。

#### 手工上传 `DirectUpload`

`DirectUpload` 已经是手工 Logo 应继续复用的最小实现：

1. 浏览器计算 SHA-256（`frontend/src/shared/components/DirectUpload.tsx:8`）。
2. `POST /api/v1/files/upload-intents`，携带 category、文件元数据、哈希和 access level（`frontend/src/shared/components/DirectUpload.tsx:28`、`frontend/src/shared/components/DirectUpload.tsx:31`）。
3. 浏览器按服务端指令直接向对象存储 PUT/POST，不让文件正文经过 FastAPI（`frontend/src/shared/components/DirectUpload.tsx:32`、`frontend/src/shared/components/DirectUpload.tsx:41`）。
4. 对象传输明确失败时尽力调用 abort；完整性确认失败则保留 `pendingFileId` 供重试（`frontend/src/shared/components/DirectUpload.tsx:34`、`frontend/src/shared/components/DirectUpload.tsx:47`、`frontend/src/shared/components/DirectUpload.tsx:52`）。
5. `POST /files/{file_id}/complete` 成功后才回调 `onUploaded(FileRecord)`（`frontend/src/shared/components/DirectUpload.tsx:17`、`frontend/src/shared/components/DirectUpload.tsx:20`、`frontend/src/shared/components/DirectUpload.tsx:22`）。

平台表单已用 `category="PLATFORM_LOGO"`、`accessLevel="PUBLIC"` 和 PNG/JPEG/WebP/ICO accept 提示调用它（`frontend/src/features/configuration/PlatformsPage.tsx:408`）。`accept` 只是文件选择器提示；真正的 VERIFIED、PUBLIC、PLATFORM_LOGO、格式和 2 MiB 边界仍由服务端强制，现有测试已覆盖拒绝 SVG、超限、未校验和非公开文件（`backend/tests/unit/test_platform_branding.py:35`、`backend/tests/unit/test_platform_branding.py:66`、`backend/tests/unit/test_platform_branding.py:157`）。

官网发现不应伪装成 `DirectUpload` 的浏览器文件选择流程。它应由服务端下载、校验并落库，成功后把同样的 `file_id` 交给现有平台 Logo 绑定输入；这样手工上传与官网导入在绑定点以后共享同一生命周期。

### 当前读取与展示数据流

`PlatformAvatar` 是唯一图片渲染组件。它不区分 `UPLOAD` 和 `EXTERNAL`，统一消费 `logo.url`；图片失败后回退平台首字，并对外链设置 `referrerPolicy="no-referrer"`（`frontend/src/shared/components/PlatformAvatar.tsx:5`、`frontend/src/shared/components/PlatformAvatar.tsx:7`、`frontend/src/shared/components/PlatformAvatar.tsx:9`）。共享样式统一容器、`object-fit: contain` 和回退背景（`frontend/src/styles/global.css:653`、`frontend/src/styles/global.css:655`）。

后端读取投影也已经集中：

- 上传 Logo 通过 `_platform_logo_out` 生成 `{source:'UPLOAD', file_id, url}`，其中 `url` 是对象存储短期下载地址；旧外链生成 `{source:'EXTERNAL', url}`（`backend/app/services/projections.py:122`、`backend/app/services/projections.py:128`、`backend/app/services/projections.py:139`）。
- 平台列表/详情批量复用 `_platform_logo_out`（`backend/app/services/projections.py:146`、`backend/app/services/projections.py:151`、`backend/app/services/projections.py:223`）。
- 内容任务列表独立查询当前平台，并再次复用 `_platform_logo_out` 放入 `ContentTaskPlatformSummary.logo`，因此不是创建任务时冻结的旧 Logo（`backend/app/services/projections.py:248`、`backend/app/services/projections.py:321`、`backend/app/services/projections.py:325`）。已有集成测试明确锁定“列表使用当前平台品牌”以及旧 `EXTERNAL` 投影（`backend/tests/integration/test_publication_review_closure.py:2069`、`backend/tests/integration/test_publication_review_closure.py:2131`）。

#### 所有实际嵌入平台 Logo 的前端位置

全库只有以下四个 `PlatformAvatar` 消费位置：

| 位置 | 数据来源 | 当前 query key |
|---|---|---|
| 平台管理表格 | `GET /platform-profiles` | `['platform-profiles', query]`（`frontend/src/features/configuration/PlatformsPage.tsx:158`、`frontend/src/features/configuration/PlatformsPage.tsx:363`） |
| 平台管理详情面板 | `GET /platform-profiles/{id}` | `['platform-profile', id]`（`frontend/src/features/configuration/PlatformDetailPanel.tsx:39`、`frontend/src/features/configuration/PlatformDetailPanel.tsx:62`） |
| Prompt 平台列表 | `GET /platform-profiles` | `['platform-profiles', query]`（`frontend/src/features/configuration/PlatformPromptsPage.tsx:71`、`frontend/src/features/configuration/PlatformPromptsPage.tsx:373`） |
| 内容任务列表 | `GET /content-tasks` | `['content-tasks', query]`（`frontend/src/features/content-tasks/ContentTasksPage.tsx:85`、`frontend/src/features/content-tasks/ContentTasksPage.tsx:199`） |

`SettingsPage` 和内容任务创建 Modal 也读取 `platformProfilesQueryOptions()`，但只使用平台名称/ID，不嵌入 Logo（`frontend/src/features/settings/SettingsPage.tsx:84`、`frontend/src/features/content-tasks/ContentTasksPage.tsx:217`、`frontend/src/features/content-tasks/ContentTasksPage.tsx:257`）。路由预取的 `/configuration/platforms` 结果同样落在 `platform-profiles` 根键下（`frontend/src/app/routePrefetch.ts:57`）。

### React Query keys 与当前失效缺口

- 平台列表工厂是 `['platform-profiles', query]`，根键 `['platform-profiles']` 可以用前缀失效全部列表（`frontend/src/shared/api/queryKeys.ts:33`）。
- 平台详情使用另一个单数根键 `['platform-profile', id]`，不会被 `platformProfiles.all` 命中，所以当前代码另外失效具体详情（`frontend/src/shared/api/queryKeys.ts:36`、`frontend/src/features/configuration/PlatformsPage.tsx:181`）。
- 内容任务列表是独立根键 `['content-tasks', query]`；`queryKeys.contentTasks.all` 能以前缀命中所有任务列表（`frontend/src/shared/api/queryKeys.ts:50`）。
- 平台列表 stale time 是 5 分钟，详情 1 分钟，内容任务列表 30 秒；默认不在窗口聚焦时刷新（`frontend/src/shared/api/queryOptions.ts:92`、`frontend/src/shared/api/queryOptions.ts:98`、`frontend/src/app/queryClient.ts:4`、`frontend/src/app/queryClient.ts:11`）。
- 当前 `invalidatePlatform` 只失效平台列表和指定详情；更新 Logo 后，已缓存内容任务列表不会被主动失效（`frontend/src/features/configuration/PlatformsPage.tsx:181`）。这正是 PRD 所述 AC3 缺口。

根因不只影响 Logo：内容任务摘要同时嵌入当前平台 `name`、`website_url` 与 `logo`（`contracts/openapi.yaml:2892`）。因此最小且更稳妥的修复不是为 Logo 增加一次性特殊分支，而是在平台身份更新的统一失效函数中加入 `queryKeys.contentTasks.all`。创建后尚无引用、删除成功意味着无任务引用、启停状态也未嵌入任务摘要；这些路径额外失效一次虽无害，但真正必需的是成功更新平台身份后失效。

推荐保存成功后的失效集合：

```ts
await Promise.all([
  queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }),
  queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.detail(saved.id) }),
  queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all }),
]);
```

不需要让 `PlatformAvatar` 自建 query、事件总线或全局版本号。服务端投影中的 URL 随列表/详情重读一并更新。

### OpenAPI 与生成类型现状

- 权威契约是 OpenAPI 3.1.0、PartSignal API 0.1.1（`contracts/openapi.yaml:1`、`contracts/openapi.yaml:4`）。
- 当前创建和 PATCH 分别引用 `PlatformProfileCreate` / `PlatformProfileUpdate`；PATCH 返回新的 `PlatformProfile`（`contracts/openapi.yaml:571`、`contracts/openapi.yaml:634`）。
- 当前 `PlatformLogoInput` 是 `UPLOAD | EXTERNAL` 判别联合，读取 `PlatformLogo` 也是相同来源联合，但上传投影额外含 `url`（`contracts/openapi.yaml:2439`、`contracts/openapi.yaml:2453`、`contracts/openapi.yaml:2462`、`contracts/openapi.yaml:2476`）。
- 当前 `PlatformProfileUpdate.logo` 是 required；生成 TypeScript 因而是必填 `logo: PlatformLogoInput | null`（`contracts/openapi.yaml:2421`、`contracts/openapi.yaml:2424`、`frontend/src/shared/api/schema.d.ts:1823`、`frontend/src/shared/api/schema.d.ts:1831`）。
- 内容任务摘要直接复用读取侧 `PlatformLogo`，因此旧 `EXTERNAL` 兼容只需要保留在读取投影（`contracts/openapi.yaml:2892`、`frontend/src/shared/api/schema.d.ts:2222`）。
- 业务组件通过 `Schema<Name>` 和生成的 `paths` 使用契约，没有平行 DTO（`frontend/src/shared/api/types.ts:1`、`frontend/src/shared/api/types.ts:4`）。
- `npm run api:generate` 使用 `openapi-typescript` 生成 `schema.d.ts`，`npm run api:check` 在临时目录重生成并逐字比较（`frontend/package.json:16`、`frontend/scripts/check-openapi.mjs:7`、`frontend/scripts/check-openapi.mjs:14`）。

### 最小 MVP UX

#### 同一个表单区完成，不新增页面

1. 保留“官方网站”字段和现有 Logo 表单区。
2. Logo 区首先展示当前 Logo：
   - `UPLOAD`：使用 `PlatformAvatar` 展示当前自有 Logo；
   - `EXTERNAL`：使用 `PlatformAvatar` 展示，并标注“旧外链 Logo（只读）”，可显示原 URL 链接，但不提供编辑输入和 `EXTERNAL` 选项；
   - `null`：展示首字回退或“未设置”。
3. 提供两个既有业务所需入口：
   - “从官网发现”：只有当前 `website_url` 通过 Form URL 校验后可触发；
   - “手工上传”：继续使用 `DirectUpload`。
4. 官网发现成功后在表单内只显示一张候选图，以及“使用此 Logo”“取消”两个次操作。不得展示候选来源评分、第二张图或自动选中状态。
5. 点击“取消”只清空页面本地 candidate state，不调用平台 POST/PATCH，不改变 `expected_revision`，当前 Logo 和其他表单字段保持不变。
6. 点击“使用此 Logo”只把候选 `file_id` 记为待提交的 `UPLOAD` Logo，并显示“保存平台后生效”；仍不修改服务端平台。
7. 用户点击既有“创建平台”或“保存平台”时，才通过现有 `PlatformProfileCreate` / `PlatformProfileUpdate` 原子绑定 Logo。这样“候选确认”和其他平台字段共用一次 revision 校验，不引入第二个保存时序。
8. 发现失败直接使用统一 `errorMessage`/Ant Alert 展示服务端明确错误，并保留当前 Logo；不回退到首字候选、通用占位图或手工猜测 URL。

“使用此 Logo”是表单内确认，不是第二个服务端写操作。这一取舍同时满足确认后才进入待绑定状态、取消不改 revision，并避免“先绑 Logo 导致 revision +1，随后保存其他字段立即冲突”的额外流程。

#### 旧 `EXTERNAL` 的编辑语义

- 创建表单和编辑表单都不得再显示“使用外部 URL”选项。
- 旧外链只来自读取投影，列表、详情、Prompt 和任务页继续由现有 `PlatformAvatar` 展示。
- 编辑旧外链平台的其他字段时，前端必须省略 `logo`，由服务端保持旧值；不能把旧 URL 重新提交为写入输入。
- 管理员只有三种显式结果：保持（省略）、清空（`null`）、用官网候选或手工上传替换（`UPLOAD`）。

### 推荐的最小 API 形状

#### 1. 单一候选发现端点

```yaml
/api/v1/platform-logo-candidates:
  post:
    operationId: createPlatformLogoCandidate
    # 写请求携带既有 CSRF Header
    requestBody:
      application/json:
        schema: PlatformLogoCandidateCreate
    responses:
      '201':
        application/json:
          schema: PlatformLogoCandidate

PlatformLogoCandidateCreate:
  required: [website_url]
  properties:
    website_url: {type: string, format: uri}

PlatformLogoCandidate:
  required: [file_id, preview]
  properties:
    file_id: {type: string, format: uuid}
    preview: {$ref: '#/components/schemas/SignedUrl'}
```

理由：

- 使用顶层候选端点而不是 `/{platform_id}` 子资源，创建表单和编辑表单共用一个请求；不需要为尚未创建的平台伪造 ID。
- 请求只带当前表单的 `website_url`。域名规范化、Icon Horse 请求、SSRF/重定向/大小/格式校验和对象存储写入都在服务端完成，浏览器不直接请求 Icon Horse。
- 成功响应只在文件已成为 VERIFIED、PUBLIC、PLATFORM_LOGO 后返回；`file_id` 可直接复用既有绑定契约。
- 预览复用现有 `SignedUrl {url, expires_at}`，避免再发明 URL/有效期结构（`contracts/openapi.yaml:3993`）。候选 24 小时清理窗口属于服务端生命周期，不需要复制为前端倒计时状态。
- 该端点不接收 `platform_profile_id` 或 `expected_revision`，也不更新平台，所以取消天然不改变 revision。

错误继续使用统一 `ErrorResponse`。具体错误码由主 Agent 在后端设计中冻结，但 UI 只需要区分成功与明确失败并原样显示中文 message；不得在前端按模糊字符串猜测错误原因。

#### 2. 拆分写入类型与读取投影

推荐契约语义：

```yaml
PlatformLogoInput:
  # 只允许新写入自有文件
  $ref: '#/components/schemas/PlatformLogoUploadInput'

PlatformProfileCreate.logo:
  # 省略/null = 不设置；UPLOAD = 绑定文件
  optional: true

PlatformProfileUpdate.logo:
  # 省略 = 保持；null = 清空；UPLOAD = 替换
  optional: true

PlatformLogo:
  # 读取侧暂时保留旧值兼容
  oneOf: [PlatformLogoUpload, PlatformLogoExternal]
```

不建议保留可写 `PlatformLogoExternalInput` 再依赖前端隐藏选项，因为 API 仍能创建新外链；也不建议让前端在保存旧平台时回传同一 URL，由服务端比较“是否变化”，那会保留不必要的兼容写分支。输入只允许 `UPLOAD`、输出暂时允许 `EXTERNAL` 是最直接的契约。

`logo` 的省略语义必须在 OpenAPI description、运行时 Schema 和服务实现中同时明确。当前服务把 `None` 解释为清空，不能只把生成类型改成 optional；服务端必须能区分字段未提供与显式 `null`，否则旧外链仍会被无意清空。

### 测试现状与最小新增验证

#### 已有覆盖

- 配置页测试验证平台表格内 Avatar 尺寸，但不验证图片 URL、失败回退或来源兼容（`frontend/src/features/configuration/ConfigurationPages.test.tsx:186`、`frontend/src/features/configuration/ConfigurationPages.test.tsx:196`）。
- 当前测试明确允许编辑外部 URL，并断言 PATCH 提交 `EXTERNAL`；该测试必须改成“旧外链只读且无新外链选项”（`frontend/src/features/configuration/ConfigurationPages.test.tsx:224`）。
- 当前测试覆盖显式清空 Logo 和保存失败反馈（`frontend/src/features/configuration/ConfigurationPages.test.tsx:249`、`frontend/src/features/configuration/ConfigurationPages.test.tsx:267`）。
- 内容任务页 fixture 的 `platform.logo` 恒为 `null`，没有覆盖 Logo 展示或平台保存后的缓存刷新（`frontend/src/features/content-tasks/ContentTasksPage.test.tsx:61`、`frontend/src/features/content-tasks/ContentTasksPage.test.tsx:68`）。
- 没有 `DirectUpload.test.tsx` 或 `PlatformAvatar.test.tsx`；现有上传相关页面测试都 mock 了 `DirectUpload`，没有保护其真实两段上传/重试流程。
- 后端已有上传文件约束、外链输入和内容任务当前平台投影测试，但尚无官网候选 API（`backend/tests/unit/test_platform_branding.py:23`、`backend/tests/unit/test_platform_branding.py:35`、`backend/tests/integration/test_publication_review_closure.py:2069`）。

#### 前端最小新增测试

1. **旧外链只读**：编辑 `EXTERNAL` 平台时仍看到旧图/URL，但来源控件没有“使用外部 URL”；只改名称保存时请求携带原 `expected_revision` 且省略 `logo`。
2. **发现→取消**：mock 候选 POST 返回单个候选，断言只出现一张预览；点击取消后没有平台 PATCH、表单 `expected_revision` 仍是原值、当前 Logo 未改变。
3. **发现→确认→保存**：点击“使用此 Logo”后仍没有平台 PATCH；点击既有保存后才提交 `{source:'UPLOAD', file_id}` 和原 `expected_revision`。
4. **手工上传保留**：mock `DirectUpload.onUploaded` 后走同一待提交 `file_id`，避免官网发现和手工上传形成两个绑定实现。
5. **缓存失效**：平台 PATCH 成功后断言 `platformProfiles.all`、具体 detail 和 `contentTasks.all` 都被失效；至少让一个预置内容任务列表重新读取新 Logo。
6. **展示兼容**：给 `PlatformAvatar` 一个旧 `EXTERNAL` 投影，断言 `img.src`、空 alt、`no-referrer`；触发 error 后断言回退首字。该测试可单独放共享组件，也可在配置页完成。

跨层最小验证顺序：

```bash
cd frontend
npm run api:generate
npm run api:check
npm run typecheck
npx vitest run src/features/configuration/ConfigurationPages.test.tsx src/features/content-tasks/ContentTasksPage.test.tsx
```

完整后端候选流程可再用一条 Playwright E2E 覆盖“发现单候选→取消不变→再次发现并确认保存→进入内容任务页看到新 Logo”；不要为每种远端错误复制 E2E，协议/大小/SSRF/格式错误应由后端单元与集成测试承担。

### Code Patterns

- API 只能通过 `openapi-fetch` 生成路径调用，统一客户端持有 session、CSRF 和结构化错误（`frontend/src/shared/api/client.ts:1`、`frontend/src/shared/api/client.ts:27`、`frontend/src/shared/api/client.ts:43`）。
- 服务端状态由 TanStack Query 持有，表单、Modal 与临时候选属于页面本地状态；项目规范明确禁止为此增加全局 Store（`.trellis/spec/frontend/state-management.md:19`、`.trellis/spec/frontend/state-management.md:29`、`.trellis/spec/frontend/state-management.md:38`）。
- 数据获取直接使用生成类型、query key 和 query options，不应为单个请求再包一层隐藏 key 的 Hook（`.trellis/spec/frontend/hook-guidelines.md:37`）。
- Form 使用现有 Ant Design 控件和服务端校验契约；错误必须可感知，长期保存使用现有 message（`.trellis/spec/frontend/visual-system.md:189`、`.trellis/spec/frontend/visual-system.md:210`、`.trellis/spec/frontend/visual-system.md:211`）。
- 平台 Logo 必须复用官方标识和统一容器，不新增图标库或第二套 Avatar（`.trellis/spec/frontend/visual-system.md:216`、`.trellis/spec/frontend/visual-system.md:217`）。

### External References / Versions

- Icon Horse：当前任务 PRD 已冻结 MVP 调用为 `GET https://icon.horse/icon/{domain}`，且只返回服务端选定的一张图片；本次研究未重新联网验证。
- OpenAPI 文档版本：3.1.0；PartSignal API 契约版本 0.1.1（`contracts/openapi.yaml:1`、`contracts/openapi.yaml:4`）。
- 当前安装版本（从本地 `node_modules` 读取）：`openapi-typescript 7.13.0`、`@tanstack/react-query 5.101.2`、`antd 6.5.1`、`react 19.2.7`。`package.json` 使用兼容范围而非锁死这些精确版本（`frontend/package.json:20`、`frontend/package.json:47`）。

### Related Specs

- `.trellis/tasks/07-27-automatic-logo-ingestion-and-cleanup/prd.md`：R1–R9、R16、R18–R20 与 AC3、AC8、AC9、AC11。
- `.trellis/spec/frontend/index.md`：前端开发前置规范入口。
- `.trellis/spec/frontend/state-management.md`：服务端状态、表单本地状态、保存后显式失效与 revision 所有权。
- `.trellis/spec/frontend/hook-guidelines.md`：生成 API 类型/query key/query options 的直接使用边界。
- `.trellis/spec/frontend/component-guidelines.md`：共享组件不拥有业务状态与恢复路径。
- `.trellis/spec/frontend/quality-guidelines.md`：表单、错误反馈与 mutation 成功反馈要求。
- `.trellis/spec/frontend/visual-system.md`：表单、按钮层级、Logo、错误、响应式和可访问性约束。
- `.trellis/spec/guides/cross-layer-thinking-guide.md`：API→生成类型→页面→缓存的完整数据流必须一致。
- `.trellis/spec/guides/code-reuse-thinking-guide.md`：复用现有上传、Avatar、query key 和 SignedUrl，避免第二套实现。

## Caveats / Not Found

- 当前代码和 OpenAPI 中不存在 Logo 候选发现端点、候选响应 Schema 或前端候选状态；上述 API 是供 `design.md` 冻结的最小提案，不是现状。
- 当前任务目录尚无 `design.md` / `implement.md`；复杂任务在进入实现前仍需由主 Agent 完成并评审。
- 上传 Logo 的投影 URL 是 300 秒短期下载地址（`backend/app/config.py:80`、`backend/app/services/projections.py:163`），而平台列表 stale time 也是 300 秒且默认不随窗口聚焦刷新。新候选响应应复用带 `expires_at` 的 `SignedUrl`；若预览过期，界面应明确允许重新发现，不能把加载失败当作确认成功。
- `PlatformAvatar` 在同一次挂载内会记住失败 URL并回退首字；平台查询重读后上传 Logo URL 会变化，从而恢复渲染。若未来改成稳定公共 URL，需要重新评估失败状态重试，但本 MVP 不需要先做抽象。
- 精确错误码、候选审计字段和对象清理实现属于后端/契约设计；前端不应先发明兼容分支。
- 本次为只读研究，未运行测试，也未修改代码、契约或规范。
