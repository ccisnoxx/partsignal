# Research: response-drift-classification

- Query: 复现并分类冻结 contracts/openapi.yaml 与 FastAPI 运行时 OpenAPI 的共享操作响应状态集合、响应 media/body/schema 漂移。
- Scope: internal（冻结 OpenAPI、运行时 app.openapi()、后端路由/错误处理/契约检查器）。
- Date: 2026-08-31

## Findings

### Headline counts

- 冻结契约操作数：162；运行时操作数：162；共享操作数：162；契约独有/运行时独有：0/0。
- 响应 status-set 漂移：156/162 个共享操作；无漂移：6 个。
- 冻结契约响应状态出现次数（按操作计）：200=120，201=21，202=3，204=20，401=125，403=115，404=88，409=97，422=80，502=2，503=2，504=2。
- 运行时响应状态出现次数（按操作计）：200=120，201=21，202=3，204=20，422=149。
- 状态集合缺失侧累计：401=125，403=115，404=88，409=97，502=2，503=2，504=2；额外侧仅有运行时自动 422=69。

### Root-cause categories (multi-label)

以下按“一个操作命中一个类别即可计数”统计，类别不是互斥分桶；同一操作可同时缺少认证、资源、冲突和上游状态。

| 类别 | 操作数 | 口径/证据 |
|---|---:|---|
| 认证/授权状态声明缺失 | 128（401=125，403=115；重叠=112） | 契约声明的 401/403 未进入运行时 response map；多数路由 decorator 未提供 responses=。 |
| 资源不存在/状态冲突声明缺失 | 115（404=88，409=97；重叠=70） | 契约声明的 404/409 未进入运行时 response map；这只说明 OpenAPI 声明漂移，不证明对应业务分支失效。 |
| 外部依赖错误声明缺失 | 4（502=2，503=2，504=2） | 502/504 命中模型发现/测试两操作；503 命中 ready health 与 logo candidate；与其他类别有重叠。 |
| 422 合同/生成器形状与状态声明漂移 | 80 个共同 422 的 body schema 不同；另有运行时额外 422=69 | 冻结 422 指向 ErrorEnvelope，运行时自动 422 指向 FastAPI/Pydantic HTTPValidationError；自动 422 的操作集合比契约多。 |

根因锚点：backend/app/main.py:38 创建 FastAPI app，backend/app/main.py:119-127 汇总路由；全项目路由只在 backend/app/routers/identity.py:142 和 backend/app/routers/configuration.py:305-307 找到显式 responses=，其余 decorator 依赖 FastAPI 默认生成响应。统一业务错误 handler 位于 backend/app/main.py:48-50 与 backend/app/errors.py:20-47，但异常 handler 不会自动把业务状态写入 OpenAPI operation response map。

### Representative status drift

| Path + method | Missing in runtime | Extra in runtime | 说明 |
|---|---|---|---|
| GET /api/health/ready | 503 | — | 冻结契约 contracts/openapi.yaml:34-45 声明依赖不可用错误；运行时实现实际在 backend/app/main.py:99-115 抛出 503，但 decorator 未声明。 |
| POST /api/v1/auth/login | 401 | 422 | 契约 contracts/openapi.yaml:46-62；运行时 route backend/app/routers/identity.py:103-105 无 responses=，登录输入校验触发默认 422。 |
| GET /api/v1/products/{product_id} | 404 | 422 | 契约 contracts/openapi.yaml:341-352；实现 backend/app/routers/product_facts.py:122-125 有 not_found 分支，但未在 decorator 声明。 |
| POST /api/v1/ai-channels/{channel_id}/discover-models | 401,403,404,409,502,504 | — | 契约 contracts/openapi.yaml:1249-1269；代表多标签的认证、资源、冲突、上游错误缺失。 |
| GET /api/v1/platform-profiles/export | 401,403 | — | 成功响应另有 text/csv → application/json media 漂移。 |
| GET /api/v1/query-topics | — | — | 六个 status-set 无漂移操作之一；不代表全体响应合同已一致。 |

### Response body/media/schema drift

- 共同 status 的响应条目共 244 个；成功状态共同条目 164 个（200/201/202/204 分别为 120/21/3/20）。
- media-type 集合漂移：2 个成功响应，均为冻结 text/csv、运行时 application/json：GET /api/v1/platform-profiles/export 与 GET /api/v1/users/export。
- 共同 422：80 个，均为 body schema 漂移：冻结 422 $ref → ErrorEnvelope（contracts/openapi.yaml:3339-3344），运行时 → HTTPValidationError（detail[]，不含项目统一 error.code/message/request_id）。运行时额外 422 的 69 个操作没有冻结对应 response，因此只计状态/覆盖漂移，不虚构其“共同 schema”比较。
- 共同成功响应经 $ref 展开并归一化 const、nullable、allOf、生成标题和数值字面量后，仍有 7 个 schema 差异：health checks 运行时允许 null（2 个）；Content Task Detail 的 Geo basis 运行时加入 discriminator metadata（2 个）；Generation input snapshot 冻结使用 oneOf、运行时使用 anyOf（3 个）。
- 其余成功响应的 raw $ref 名称差异主要是冻结模型名与运行时 *Out 模型名不同；展开后字段/required/约束相同，不单独记为业务 shape drift。

| 成功 schema 差异 | 操作数 | 具体位置 |
|---|---:|---|
| nullable 允许范围 | 2 | GET /api/health/live、GET /api/health/ready：冻结 HealthResponse.checks 为可省略 object，运行时 HealthResponse 定义为 dict[str,str] | None = None（backend/app/schemas/common.py:223-225）。 |
| discriminator metadata | 2 | GET /api/v1/content-tasks/{content_task_id}/detail、GET /api/v1/content-tasks/{content_task_id}/editor-context：ContentTaskDetailGeoBasis 使用 Field(discriminator="rule_code")（backend/app/schemas/content_task_detail.py:68-76），运行时输出 discriminator，冻结 schema 未输出。 |
| oneOf vs anyOf | 3 | GET /api/v1/content-tasks/{content_task_id}/review-context、GET /api/v1/content-versions/{content_version_id}/review-context、GET /api/v1/generation-jobs/{generation_job_id}：冻结 GenerationInputSnapshot.oneOf，运行时 Pydantic union 输出 anyOf。 |

### Status pattern distribution

| 数量 | Missing in runtime | Extra in runtime |
|---:|---|---|
| 47 | {401, 403, 404, 409} | — |
| 18 | {401, 403, 404, 409} | {422} |
| 16 | — | {422} |
| 11 | {401, 403} | — |
| 11 | {401, 403, 404} | {422} |
| 9 | {409} | {422} |
| 6 | {401} | — |
| 5 | {401, 403, 404} | — |
| 4 | {401} | {422} |
| 4 | {401, 403, 409} | {422} |
| 2 | {401, 403} | {422} |
| 2 | {401, 403, 404, 409, 502, 504} | — |
| 2 | {401, 404, 409} | {422} |
| 1 | {401, 403, 409, 503} | — |
| 1 | {401, 404} | — |
| 1 | {403} | — |
| 1 | {403, 404, 409} | {422} |
| 1 | {403, 409} | {422} |
| 1 | {404} | {422} |
| 1 | {409} | — |
| 1 | {503} | — |

### Methodology and exact commands

1. 读取冻结 contracts/openapi.yaml，调用同一 Python 环境中的 app.openapi()；仅纳入 get/post/put/patch/delete，把 path-level parameters 合并到 operation map。
2. 对每个共享 (path, method) 将 response key 转为字符串，比较 contract_responses - runtime_responses（missing）及反向集合（extra）；因此“缺失”是运行时 OpenAPI 未声明，不是 HTTP 实际不可返回。
3. 对共同 response key 解析本地 $ref，比较 content media 集合和 JSON schema；schema 比较去除生成标题/描述、统一 const/nullable/allOf/数值字面量，并保留 oneOf/anyOf 差异。
4. 另行运行项目现有 partsignal-contract-check，记录其返回 0；该检查器（backend/app/tools/contract_check.py:190-253）覆盖 operation、参数、安全、request body 与有限的成功 shape，却不比较完整 response status 集、media type，也不会识别本报告列出的部分 oneOf/nullable 语义差异。

复现操作计数的最小命令（工作目录为仓库根）：

~~~bash
UV_CACHE_DIR=.cache/uv uv run --project backend python - <<'PY'
from pathlib import Path
import yaml
from app.main import app
from app.tools.contract_check import operation_map
c = yaml.safe_load(Path("contracts/openapi.yaml").read_text())
r = app.openapi()
co, ro = operation_map(c), operation_map(r)
shared = sorted(set(co) & set(ro))
drift = []
for key in shared:
    cs = {str(x) for x in co[key]["responses"]}
    rs = {str(x) for x in ro[key]["responses"]}
    if cs != rs:
        drift.append((key, sorted(cs-rs), sorted(rs-cs)))
print(len(co), len(ro), len(shared), len(drift))
for row in drift:
    print(row)
PY
~~~

本次实际运行的环境/质量命令：

~~~bash
mkdir -p .trellis/tasks/08-31-non-2xx-contract-check/research
UV_CACHE_DIR=.cache/uv uv run --project backend partsignal-contract-check
UV_CACHE_DIR=.cache/uv uv run --project backend python -c "import fastapi, pydantic, starlette; print(fastapi.__version__, pydantic.__version__, starlette.__version__)"
~~~

观测版本：FastAPI 0.139.0、Pydantic 2.13.4、Starlette 1.3.1；锁文件锚点 backend/uv.lock:345-357,793-804,1029-1038，项目范围约束 backend/pyproject.toml:1-3,10-27。

## Files found

- contracts/openapi.yaml：冻结 OpenAPI 3.1.0；操作、状态集合、ErrorResponse 和 schemas 的权威来源。
- backend/app/main.py：FastAPI app、health routes、异常 handler 注册及 router 汇总。
- backend/app/routers/*.py：运行时 route decorators 和 response_model；除两个局部 responses= 外未为契约错误状态声明 responses。
- backend/app/errors.py：业务错误与 validation 错误的运行时 JSON 信封。
- backend/app/tools/contract_check.py：现有有限语义检查器；不等同于完整 non-2xx response gate。
- backend/tests/unit/test_contract.py：当前测试只断言 check(contract) == []，并有若干冻结契约局部断言（例如 backend/tests/unit/test_contract.py:22-24,46-57,99-116）。
- .trellis/spec/backend/error-handling.md：要求 ErrorEnvelope、稳定错误码、非 2xx contract/runtime/generated contract check；与本审计相关。
- .trellis/tasks/08-30-v2-live-readonly-acceptance/{prd,design,implement}.md：父任务的线上验收边界、只读约束、Query Topic 422 运行时证据及 staging 语义；本审计未将线上 UI 结果当作 OpenAPI 结论。

## Related specs

- .trellis/spec/backend/error-handling.md:14-33,45-60：ErrorEnvelope、409/422 映射和必须执行的 contract/runtime/generated contract check。
- .trellis/spec/backend/index.md:1-18：后端规范索引及 active error handling guideline。
- backend/AGENTS.md:1-8：后端边界、合同缺口需报告主 Agent、不可修改 contracts 的约束。

## External references

- 未使用外部网页资料；本结论以仓库冻结契约、运行时生成文档及锁定依赖版本为准。FastAPI/Pydantic 的默认 validation response 形状以本地 app.openapi() 实测结果为证据。

## Caveats / Not Found

- 状态集合差异只表示 OpenAPI 声明漂移，不能据此断言业务实现不能返回相应 HTTP 状态；例如 GET /api/v1/products/{product_id} 的代码确有 not_found 分支，但 decorator 没有声明 404。
- app.openapi() 是当前源码进程的 runtime schema，不是公网部署实例的 /openapi.json；未进行网络部署文档对比，也未改动线上状态。
- 运行时 app import 未连接数据库/Redis 以生成 schema；因此本报告不证明依赖健康、权限、异常分支或真实 response body，只证明静态 OpenAPI 生成结果。
- 422 schema 的 80 个共同条目是明确 ErrorEnvelope vs HTTPValidationError 差异；运行时额外 422 的 69 个操作没有冻结 response，不能从 extra 推导契约是否有意禁止或遗漏。
- schema 归一化刻意忽略生成 title/description 和 $ref 名称；如果消费者依赖这些文档元数据，应另设 metadata gate。oneOf vs anyOf 与 runtime nullable 则保留为当前可见差异。
- 本报告的 media/schema 统计比较两份 OpenAPI，不是实际 response Header inventory。两份文档共同遗漏的全局 `X-Request-ID`、login/logout 多实例 `Set-Cookie`，以及实际 ErrorEnvelope 始终存在但冻结 schema 未列为 required 的 `details`，另见 `route-response-authority-audit.md`；它们必须在 authority reconciliation 中处理，不能因 baseline 未计数而排除。

## Raw per-operation drift inventory

共 156 行；按 path、method 排序。Missing in runtime 是冻结有而运行时无，Extra in runtime 是运行时有而冻结无。

| # | Method | Path | Contract statuses | Runtime statuses | Missing in runtime | Extra in runtime |
|---:|---|---|---|---|---|---|
| 1 | GET | /api/health/ready | {200, 503} | {200} | {503} | — |
| 2 | DELETE | /api/v1/ai-channel-headers/{header_id} | {204, 401, 403, 404, 409, 422} | {204, 422} | {401, 403, 404, 409} | — |
| 3 | PATCH | /api/v1/ai-channel-headers/{header_id} | {200, 401, 403, 404, 409} | {200, 422} | {401, 403, 404, 409} | {422} |
| 4 | GET | /api/v1/ai-channels | {200, 401, 403} | {200, 422} | {401, 403} | {422} |
| 5 | POST | /api/v1/ai-channels | {201, 401, 403} | {201, 422} | {401, 403} | {422} |
| 6 | DELETE | /api/v1/ai-channels/{channel_id} | {204, 401, 403, 404, 409, 422} | {204, 422} | {401, 403, 404, 409} | — |
| 7 | GET | /api/v1/ai-channels/{channel_id} | {200, 401, 403, 404} | {200, 422} | {401, 403, 404} | {422} |
| 8 | PATCH | /api/v1/ai-channels/{channel_id} | {200, 401, 403, 404, 409} | {200, 422} | {401, 403, 404, 409} | {422} |
| 9 | PUT | /api/v1/ai-channels/{channel_id}/api-key | {200, 401, 403, 404, 409} | {200, 422} | {401, 403, 404, 409} | {422} |
| 10 | GET | /api/v1/ai-channels/{channel_id}/audit-logs | {200, 401, 403, 404} | {200, 422} | {401, 403, 404} | {422} |
| 11 | POST | /api/v1/ai-channels/{channel_id}/disable | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 12 | POST | /api/v1/ai-channels/{channel_id}/discover-models | {200, 401, 403, 404, 409, 422, 502, 504} | {200, 422} | {401, 403, 404, 409, 502, 504} | — |
| 13 | POST | /api/v1/ai-channels/{channel_id}/enable | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 14 | POST | /api/v1/ai-channels/{channel_id}/headers | {201, 401, 403, 404, 409} | {201, 422} | {401, 403, 404, 409} | {422} |
| 15 | GET | /api/v1/ai-channels/{channel_id}/models | {200, 401, 403, 404} | {200, 422} | {401, 403, 404} | {422} |
| 16 | POST | /api/v1/ai-channels/{channel_id}/models | {201, 401, 403, 404} | {201, 422} | {401, 403, 404} | {422} |
| 17 | GET | /api/v1/ai-channels/{channel_id}/usage-summary | {200, 401, 403, 404} | {200, 422} | {401, 403, 404} | {422} |
| 18 | DELETE | /api/v1/ai-models/{model_id} | {204, 401, 403, 404, 409, 422} | {204, 422} | {401, 403, 404, 409} | — |
| 19 | PATCH | /api/v1/ai-models/{model_id} | {200, 401, 403, 404, 409} | {200, 422} | {401, 403, 404, 409} | {422} |
| 20 | POST | /api/v1/ai-models/{model_id}/disable | {200, 401, 403, 404, 409} | {200, 422} | {401, 403, 404, 409} | {422} |
| 21 | POST | /api/v1/ai-models/{model_id}/enable | {200, 401, 403, 404, 409} | {200, 422} | {401, 403, 404, 409} | {422} |
| 22 | POST | /api/v1/ai-models/{model_id}/test | {200, 401, 403, 404, 409, 422, 502, 504} | {200, 422} | {401, 403, 404, 409, 502, 504} | — |
| 23 | GET | /api/v1/audit-logs | {200, 401, 403, 422} | {200, 422} | {401, 403} | — |
| 24 | GET | /api/v1/audit-logs/filter-options | {200, 401, 403} | {200} | {401, 403} | — |
| 25 | GET | /api/v1/audit-logs/{audit_log_id} | {200, 401, 403, 404, 409} | {200, 422} | {401, 403, 404, 409} | {422} |
| 26 | POST | /api/v1/auth/change-password | {204, 401} | {204, 422} | {401} | {422} |
| 27 | GET | /api/v1/auth/csrf | {200, 403} | {200} | {403} | — |
| 28 | POST | /api/v1/auth/login | {200, 401} | {200, 422} | {401} | {422} |
| 29 | POST | /api/v1/auth/logout | {204, 401} | {204, 422} | {401} | {422} |
| 30 | GET | /api/v1/auth/me | {200, 204, 401} | {200, 204} | {401} | — |
| 31 | PUT | /api/v1/content-humanization-prompt | {200, 409} | {200, 422} | {409} | {422} |
| 32 | GET | /api/v1/content-tasks | {200, 401, 422} | {200, 422} | {401} | — |
| 33 | POST | /api/v1/content-tasks | {201, 401, 403, 404, 409, 422} | {201, 422} | {401, 403, 404, 409} | — |
| 34 | GET | /api/v1/content-tasks/creation-options | {200, 401, 403, 422} | {200, 422} | {401, 403} | — |
| 35 | DELETE | /api/v1/content-tasks/{content_task_id} | {204, 401, 403, 404, 409, 422} | {204, 422} | {401, 403, 404, 409} | — |
| 36 | GET | /api/v1/content-tasks/{content_task_id} | {200} | {200, 422} | — | {422} |
| 37 | POST | /api/v1/content-tasks/{content_task_id}/archive | {200, 401, 403, 404, 409} | {200, 422} | {401, 403, 404, 409} | {422} |
| 38 | POST | /api/v1/content-tasks/{content_task_id}/cancel | {200, 409} | {200, 422} | {409} | {422} |
| 39 | GET | /api/v1/content-tasks/{content_task_id}/content-versions | {200} | {200, 422} | — | {422} |
| 40 | GET | /api/v1/content-tasks/{content_task_id}/detail | {200, 401, 403, 404, 422} | {200, 422} | {401, 403, 404} | — |
| 41 | GET | /api/v1/content-tasks/{content_task_id}/editor-context | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 42 | GET | /api/v1/content-tasks/{content_task_id}/generation-jobs | {200} | {200, 422} | — | {422} |
| 43 | POST | /api/v1/content-tasks/{content_task_id}/generation-jobs | {202, 409} | {202, 422} | {409} | {422} |
| 44 | GET | /api/v1/content-tasks/{content_task_id}/generation-options | {200, 409} | {200, 422} | {409} | {422} |
| 45 | POST | /api/v1/content-tasks/{content_task_id}/manual-versions | {201, 409, 422} | {201, 422} | {409} | — |
| 46 | POST | /api/v1/content-tasks/{content_task_id}/permanent-delete | {204, 401, 403, 404, 409, 422} | {204, 422} | {401, 403, 404, 409} | — |
| 47 | GET | /api/v1/content-tasks/{content_task_id}/permanent-deletion-preview | {200, 401, 403, 404, 409} | {200, 422} | {401, 403, 404, 409} | {422} |
| 48 | POST | /api/v1/content-tasks/{content_task_id}/restore | {200, 401, 403, 404, 409} | {200, 422} | {401, 403, 404, 409} | {422} |
| 49 | GET | /api/v1/content-tasks/{content_task_id}/review-context | {200, 401, 404, 409} | {200, 422} | {401, 404, 409} | {422} |
| 50 | DELETE | /api/v1/content-versions/{content_version_id} | {204, 401, 403, 404, 409} | {204, 422} | {401, 403, 404, 409} | {422} |
| 51 | GET | /api/v1/content-versions/{content_version_id} | {200} | {200, 422} | — | {422} |
| 52 | PUT | /api/v1/content-versions/{content_version_id} | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 53 | POST | /api/v1/content-versions/{content_version_id}/abandon | {200, 409} | {200, 422} | {409} | {422} |
| 54 | POST | /api/v1/content-versions/{content_version_id}/approve | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 55 | GET | /api/v1/content-versions/{content_version_id}/compare/{other_version_id} | {200} | {200, 422} | — | {422} |
| 56 | GET | /api/v1/content-versions/{content_version_id}/detail | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 57 | POST | /api/v1/content-versions/{content_version_id}/humanization-jobs | {202, 409} | {202, 422} | {409} | {422} |
| 58 | GET | /api/v1/content-versions/{content_version_id}/publication-package | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 59 | POST | /api/v1/content-versions/{content_version_id}/request-changes | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 60 | GET | /api/v1/content-versions/{content_version_id}/review-context | {200, 401, 404, 409} | {200, 422} | {401, 404, 409} | {422} |
| 61 | POST | /api/v1/content-versions/{content_version_id}/submit-review | {200} | {200, 422} | — | {422} |
| 62 | DELETE | /api/v1/fact-versions/{fact_version_id} | {204, 403, 404, 409} | {204, 422} | {403, 404, 409} | {422} |
| 63 | GET | /api/v1/fact-versions/{fact_version_id} | {200, 401, 403, 404, 422} | {200, 422} | {401, 403, 404} | — |
| 64 | POST | /api/v1/fact-versions/{fact_version_id}/approve | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 65 | POST | /api/v1/fact-versions/{fact_version_id}/request-changes | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 66 | POST | /api/v1/fact-versions/{fact_version_id}/retire | {200} | {200, 422} | — | {422} |
| 67 | GET | /api/v1/fact-versions/{fact_version_id}/review-context | {200, 401, 403, 404} | {200, 422} | {401, 403, 404} | {422} |
| 68 | POST | /api/v1/files/upload-intents | {201} | {201, 422} | — | {422} |
| 69 | GET | /api/v1/files/{file_id} | {200} | {200, 422} | — | {422} |
| 70 | POST | /api/v1/files/{file_id}/abort | {200, 409} | {200, 422} | {409} | {422} |
| 71 | GET | /api/v1/files/{file_id}/download-url | {200} | {200, 422} | — | {422} |
| 72 | GET | /api/v1/generation-jobs/{generation_job_id} | {200} | {200, 422} | — | {422} |
| 73 | POST | /api/v1/generation-jobs/{generation_job_id}/retry | {202} | {202, 422} | — | {422} |
| 74 | GET | /api/v1/geo-insights | {200, 401, 404, 422} | {200, 422} | {401, 404} | — |
| 75 | POST | /api/v1/geo-insights/optimization-content-tasks | {201, 401, 403, 409, 422} | {201, 422} | {401, 403, 409} | — |
| 76 | GET | /api/v1/geo-metrics | {200} | {200, 422} | — | {422} |
| 77 | GET | /api/v1/geo-observation-publications | {200, 401, 403, 404, 422} | {200, 422} | {401, 403, 404} | — |
| 78 | GET | /api/v1/geo-observations | {200} | {200, 422} | — | {422} |
| 79 | POST | /api/v1/geo-observations | {201, 401, 403, 404, 409, 422} | {201, 422} | {401, 403, 404, 409} | — |
| 80 | GET | /api/v1/geo-observations/list-items | {200, 401, 403, 409, 422} | {200, 422} | {401, 403, 409} | — |
| 81 | DELETE | /api/v1/geo-observations/{observation_id} | {204, 401, 403, 404, 409, 422} | {204, 422} | {401, 403, 404, 409} | — |
| 82 | GET | /api/v1/geo-observations/{observation_id} | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 83 | GET | /api/v1/geo-observations/{observation_id}/correction-context | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 84 | GET | /api/v1/geo-observations/{observation_id}/detail | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 85 | GET | /api/v1/platform-accounts | {200, 401} | {200, 422} | {401} | {422} |
| 86 | POST | /api/v1/platform-accounts | {201, 401, 403, 409} | {201, 422} | {401, 403, 409} | {422} |
| 87 | DELETE | /api/v1/platform-accounts/{platform_account_id} | {204, 409} | {204, 422} | {409} | {422} |
| 88 | PATCH | /api/v1/platform-accounts/{platform_account_id} | {200, 401, 403, 409} | {200, 422} | {401, 403, 409} | {422} |
| 89 | POST | /api/v1/platform-accounts/{platform_account_id}/disable | {200, 401, 403, 409} | {200, 422} | {401, 403, 409} | {422} |
| 90 | POST | /api/v1/platform-accounts/{platform_account_id}/enable | {200, 401, 403, 409} | {200, 422} | {401, 403, 409} | {422} |
| 91 | POST | /api/v1/platform-logo-candidates | {201, 401, 403, 409, 422, 503} | {201, 422} | {401, 403, 409, 503} | — |
| 92 | GET | /api/v1/platform-profiles | {200, 401, 422} | {200, 422} | {401} | — |
| 93 | POST | /api/v1/platform-profiles | {201, 401, 403, 409, 422} | {201, 422} | {401, 403, 409} | — |
| 94 | GET | /api/v1/platform-profiles/export | {200, 401, 403, 422} | {200, 422} | {401, 403} | — |
| 95 | DELETE | /api/v1/platform-profiles/{platform_profile_id} | {204, 401, 403, 404, 409} | {204, 422} | {401, 403, 404, 409} | {422} |
| 96 | GET | /api/v1/platform-profiles/{platform_profile_id} | {200, 401, 403, 404} | {200, 422} | {401, 403, 404} | {422} |
| 97 | PATCH | /api/v1/platform-profiles/{platform_profile_id} | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 98 | POST | /api/v1/platform-profiles/{platform_profile_id}/disable | {200, 401, 403, 404, 409} | {200, 422} | {401, 403, 404, 409} | {422} |
| 99 | POST | /api/v1/platform-profiles/{platform_profile_id}/enable | {200, 401, 403, 404, 409} | {200, 422} | {401, 403, 404, 409} | {422} |
| 100 | GET | /api/v1/platform-prompts | {200, 401, 403} | {200} | {401, 403} | — |
| 101 | POST | /api/v1/platform-prompts | {201, 401, 403, 409, 422} | {201, 422} | {401, 403, 409} | — |
| 102 | DELETE | /api/v1/platform-prompts/{platform_prompt_id} | {204, 401, 403, 404, 409} | {204, 422} | {401, 403, 404, 409} | {422} |
| 103 | GET | /api/v1/platform-prompts/{platform_prompt_id} | {200, 401, 403, 404} | {200, 422} | {401, 403, 404} | {422} |
| 104 | PUT | /api/v1/platform-prompts/{platform_prompt_id} | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 105 | GET | /api/v1/platform-prompts/{platform_prompt_id}/preview-options | {200, 401, 403, 404, 422} | {200, 422} | {401, 403, 404} | — |
| 106 | GET | /api/v1/platform-types | {200, 401, 403} | {200} | {401, 403} | — |
| 107 | POST | /api/v1/platform-types | {201, 401, 403, 409, 422} | {201, 422} | {401, 403, 409} | — |
| 108 | DELETE | /api/v1/platform-types/{platform_type_id} | {204, 401, 403, 404, 409, 422} | {204, 422} | {401, 403, 404, 409} | — |
| 109 | PATCH | /api/v1/platform-types/{platform_type_id} | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 110 | GET | /api/v1/products | {200} | {200, 422} | — | {422} |
| 111 | POST | /api/v1/products | {201, 401, 403, 409, 422} | {201, 422} | {401, 403, 409} | — |
| 112 | DELETE | /api/v1/products/{product_id} | {204, 403, 409} | {204, 422} | {403, 409} | {422} |
| 113 | GET | /api/v1/products/{product_id} | {200, 404} | {200, 422} | {404} | {422} |
| 114 | PATCH | /api/v1/products/{product_id} | {200, 401, 403, 409, 422} | {200, 422} | {401, 403, 409} | — |
| 115 | GET | /api/v1/products/{product_id}/detail | {200, 401, 403, 404} | {200, 422} | {401, 403, 404} | {422} |
| 116 | GET | /api/v1/products/{product_id}/fact-history | {200, 401, 403, 404, 422} | {200, 422} | {401, 403, 404} | — |
| 117 | GET | /api/v1/products/{product_id}/fact-review-context | {200, 401, 403, 404} | {200, 422} | {401, 403, 404} | {422} |
| 118 | POST | /api/v1/products/{product_id}/fact-review-submissions | {201, 401, 403, 404, 409, 422} | {201, 422} | {401, 403, 404, 409} | — |
| 119 | GET | /api/v1/products/{product_id}/fact-versions | {200} | {200, 422} | — | {422} |
| 120 | GET | /api/v1/products/{product_id}/facts | {200, 401, 403, 404} | {200, 422} | {401, 403, 404} | {422} |
| 121 | PUT | /api/v1/products/{product_id}/facts | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 122 | GET | /api/v1/publication-ready-items | {200, 401} | {200} | {401} | — |
| 123 | GET | /api/v1/publication-workbench-summary | {200, 401} | {200} | {401} | — |
| 124 | GET | /api/v1/publication-works | {200, 401, 403, 409, 422} | {200, 422} | {401, 403, 409} | — |
| 125 | POST | /api/v1/publication-works | {201, 401, 403, 404, 409, 422} | {201, 422} | {401, 403, 404, 409} | — |
| 126 | GET | /api/v1/publication-works/{work_id} | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 127 | POST | /api/v1/publication-works/{work_id}/close | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 128 | POST | /api/v1/publication-works/{work_id}/content-version | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 129 | POST | /api/v1/publication-works/{work_id}/platform-review | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 130 | PATCH | /api/v1/publication-works/{work_id}/preparation | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 131 | PUT | /api/v1/publication-works/{work_id}/result | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 132 | POST | /api/v1/publication-works/{work_id}/verifications | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 133 | GET | /api/v1/publication-works/{work_id}/workspace-context | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 134 | GET | /api/v1/published-articles | {200, 401, 403, 409, 422} | {200, 422} | {401, 403, 409} | — |
| 135 | GET | /api/v1/published-articles/{article_id} | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 136 | POST | /api/v1/published-articles/{article_id}/issues | {201, 401, 403, 404, 409, 422} | {201, 422} | {401, 403, 404, 409} | — |
| 137 | POST | /api/v1/published-articles/{article_id}/permanent-delete | {204, 401, 403, 404, 409, 422} | {204, 422} | {401, 403, 404, 409} | — |
| 138 | GET | /api/v1/published-articles/{article_id}/permanent-deletion-preview | {200, 401, 403, 404, 409} | {200, 422} | {401, 403, 404, 409} | {422} |
| 139 | GET | /api/v1/published-content-issues | {200, 401, 403, 409, 422} | {200, 422} | {401, 403, 409} | — |
| 140 | GET | /api/v1/published-content-issues/{issue_id} | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 141 | GET | /api/v1/published-content-issues/{issue_id}/repair-context | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 142 | POST | /api/v1/published-content-issues/{issue_id}/repair-task | {201, 401, 403, 404, 409, 422} | {201, 422} | {401, 403, 404, 409} | — |
| 143 | POST | /api/v1/published-content-issues/{issue_id}/resolve | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 144 | GET | /api/v1/published-content-issues/{issue_id}/workspace-context | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 145 | POST | /api/v1/query-topics | {201, 401, 403, 422} | {201, 422} | {401, 403} | — |
| 146 | GET | /api/v1/query-topics/list-items | {200, 401, 403, 422} | {200, 422} | {401, 403} | — |
| 147 | DELETE | /api/v1/query-topics/{query_topic_id} | {204, 401, 403, 404, 409, 422} | {204, 422} | {401, 403, 404, 409} | — |
| 148 | PATCH | /api/v1/query-topics/{query_topic_id} | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 149 | GET | /api/v1/users | {200, 401, 403, 422} | {200, 422} | {401, 403} | — |
| 150 | POST | /api/v1/users | {201, 401, 403, 409, 422} | {201, 422} | {401, 403, 409} | — |
| 151 | POST | /api/v1/users/bulk-status | {200, 401, 403, 422} | {200, 422} | {401, 403} | — |
| 152 | GET | /api/v1/users/export | {200, 401, 403, 422} | {200, 422} | {401, 403} | — |
| 153 | DELETE | /api/v1/users/{user_id} | {204, 401, 403, 404, 409} | {204, 422} | {401, 403, 404, 409} | {422} |
| 154 | PATCH | /api/v1/users/{user_id} | {200, 409} | {200, 422} | {409} | {422} |
| 155 | POST | /api/v1/users/{user_id}/reset-password | {200, 401, 403, 404, 409, 422} | {200, 422} | {401, 403, 404, 409} | — |
| 156 | GET | /api/v1/workbench | {200, 401} | {200} | {401} | — |
