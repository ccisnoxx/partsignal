# PSR-004 实现与验证证据

## 状态与范围

依赖PSR-002/003在manifest为done，PSR-001～003需求、实现和人工接受/独立复核已读。当前refactor/PSR-004-remove-custom-http；用户已人工审查并接受PSR-004；维护manifest为done，Trellis task为completed。没有提交、推送、部署或真实Provider调用。保留任务开始前前序SDK、部署/infra/AGENTS等修改。

## 实际变更与保留

- 整文件删除：backend/app/services/pinned_http.py（370行）、openai_client.py（229行）、backend/tests/unit/test_pinned_http.py（258行）、backend/tests/integration/test_ai_egress_https.py（149行），初始共1006行；删除全部对应transport/response/error/resolver/connect/TLS、旧协议解析与专属fake。
- 删除前追踪唯一旧协议运行时调用geo_profile_tests；维护README明确留给PSR-004。本轮先接现有AIProvider.test_connection、确认其它运行时旧模块引用为零，再删除文件。Profile预留、凭据、停用、事务外调用、当前资格/attempt/依赖revision复核与审计逻辑保持；不创建Run或自动启用。
- validate_header及正则/保留字段原样迁入ai_provider，配置/CLI/Collector已知调用者同批迁移；无旧文件shim或平行实现。严格GeneratedDraft由generation拥有，5项旧业务反例保留并接实际SDK/生成入口。
- Profile PG与E2E装配接SDK，保留权限、错误脱敏/零重试、参数、资格/revision竞争；只移除旧DNS/peer/TLS/传输期大小断言。fake provider测试整体保留，通用httpx验证真实故障/计数/隔离和载荷字节；安全测试禁止实际SDK入口。测试对照见evidence/README.md。
- architecture/operations/testing、GEO三份技术规范、AI spec、infra一条旧固定DNS验证要求、业务方案和维护README移除旧网络承诺；统一官方SDK、max_retries=0与业务责任。仅更新实际改动三份GEO技术文档SHA256。
- 本轮相对初始工作区：pyproject.toml、uv.lock、Makefile、OpenAPI/database.md、ORM/schema/Alembic零变化；历史任务/交付记录不改。httpx仍用于storage/platform_logo_files和测试；httpx2由SDK/Starlette使用。Browser/出口设施/协议/部署不改。

## 基线与集中验证

编码前293单元和39PG/本机HTTP基线通过，精确命令见prd.md。所有请求仅MockTransport或随机本机fake，PG为本轮回环65533临时实例。

### 单元

```bash
uv run --project backend pytest backend/tests/unit/test_ai_provider.py backend/tests/unit/test_ai_boundaries.py backend/tests/unit/test_contract.py backend/tests/unit/test_generation.py backend/tests/unit/test_generation_dispatch.py backend/tests/unit/test_generation_runtime_mode.py backend/tests/unit/test_generation_provider.py backend/tests/unit/test_geo_openai_collector.py backend/tests/unit/test_geo_openai_network.py backend/tests/unit/test_geo_openai_response.py backend/tests/unit/test_geo_collector_contract.py backend/tests/unit/test_geo_collector_suite.py backend/tests/unit/test_geo_fake_provider.py backend/tests/unit/test_geo_e2e_runtime.py --tb=short
```

首次exit1：530passed、1failed，35.98s。唯一失败为旧SDK配置E2E测试导入已合并装配helper。迁移实际装配测试并补Profile owner同一断言后，复验直接范围：

```bash
uv run --project backend pytest backend/tests/unit/test_ai_provider.py backend/tests/unit/test_geo_e2e_runtime.py --tb=short
```

exit0：89passed，4.25s。其他首轮成功测试相关源码、测试、配置、依赖和环境输入未变化，复用成功证据；当前14文件有效覆盖532项，不声称整轮重跑或全量unit通过。

### PostgreSQL与本机HTTP

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql://psr004@127.0.0.1:65533/postgres uv run --project backend pytest backend/tests/integration/test_ai_channel_management.py backend/tests/integration/test_ai_provider_configuration.py backend/tests/integration/test_generation_provider.py backend/tests/integration/test_geo_sdk_collection.py backend/tests/integration/test_geo_profile_tests.py backend/tests/integration/test_geo_profile_test_races.py backend/tests/integration/test_geo_security_review.py --tb=short
```

首次exit1：81passed、4failed，100.93s。4项Profile竞争测试未到达fake，源代码定位wrapper沿用factory()遗漏SDK必需allow_local_http。改为原样转发configuration后只复验失败文件：

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql://psr004@127.0.0.1:65533/postgres uv run --project backend pytest backend/tests/integration/test_geo_profile_test_races.py --tb=short
```

exit0：4passed，2.17s。其他81项输入未变，复用成功证据，当前7文件有效覆盖85项。包含配置/Bootstrap、生成/自然化、SDK GEO授权/UNKNOWN、Profile资格/权限/revision和禁止分析器外发；不记全仓integration/E2E通过。

### 静态检查

```bash
uv run --project backend ruff check backend/app/services/ai_provider.py backend/app/services/ai_configuration.py backend/app/services/geo_profile_tests.py backend/app/collectors/openai_compatible.py backend/app/cli.py backend/tests/geo_e2e_runtime.py backend/tests/unit/test_ai_provider.py backend/tests/unit/test_ai_boundaries.py backend/tests/unit/test_geo_collector_contract.py backend/tests/unit/test_geo_fake_provider.py backend/tests/unit/test_geo_e2e_runtime.py backend/tests/integration/geo_profile_test_support.py backend/tests/integration/test_geo_profile_tests.py backend/tests/integration/test_geo_profile_test_races.py backend/tests/integration/test_geo_security_review.py
uv run --project backend mypy --config-file backend/pyproject.toml backend/app/services/ai_provider.py backend/app/services/ai_configuration.py backend/app/services/geo_profile_tests.py backend/app/collectors/openai_compatible.py backend/app/cli.py
```

最终均exit0：Ruff All checks passed（15文件）；mypy Success no issues in5source files。初轮3个import顺序与1个101字符行已定向修正，没有无关格式化；运行时mypy最终复验通过。

### 收集与启动烟雾

```bash
uv run --project backend pytest backend/tests --collect-only -q
uv run --project backend pytest backend/tests/unit --collect-only -q
uv run --project backend pytest backend/tests/integration --collect-only -q
```

合并目录exit2：17个同名单元/集成模块造成import-file-mismatch，为既有目录/默认pytest导入模式限制。修正选择为分别收集后均exit0：93个unit模块3988项、123个integration模块1294项，无残留旧栈导入。这是收集证据，不是执行5282项测试。

```bash
APP_ENV=test CONTENT_GENERATOR=openai-compatible PYTHONPATH=backend uv run --project backend python -B - <<'PY'
import importlib.util
import openai
from fastapi.testclient import TestClient
from app.main import app
from app.worker import celery_app
from app.cli import main
from app.services.ai_provider import AIProvider, validate_header
from app.services.geo_profile_tests import test_profile
for name in ('app.services.pinned_http', 'app.services.openai_client'):
    assert importlib.util.find_spec(name) is None
with TestClient(app) as client:
    response = client.get('/api/health/live')
    assert response.status_code == 200 and response.json()['status'] == 'ok'
assert callable(main) and callable(test_profile)
assert 'partsignal.collect_geo_run' in celery_app.tasks
assert 'partsignal.generate_content' in celery_app.tasks
assert validate_header('X-Test', 'value') == 'x-test'
print('SDK', openai.__version__, 'API live / Worker / CLI / Profile 导入与启动烟雾通过')
PY
```

exit0，SDK3.29.0；旧模块find_spec为None，ASGI livehealth200，Worker/CLI/Profile可导入。未运行Redis readiness、Celery进程或生产启动。

## 残留搜索

```bash
rg -n "PinnedHTTPTransport|PinnedTransportError|PinnedResponse|resolve_endpoint|connect_address|wrap_tls" .
rg -n "OpenAICompatibleClient" backend tests docs deploy
rg -n "import (socket|ssl|http\.client|ipaddress)" backend/app
```

前两条exit1、无匹配；第三条exit0，仅geo_fake_server.socket、geo_ops_health.socket（gethostname）、geo_citation_urls.ipaddress。逐项用途见evidence/README.md；app无ssl或http.client AI传输。

补充rg --hidden --no-ignore，排除.git、依赖/工具缓存和引用清单自身，搜索六个旧传输符号、旧客户端、模块路径与parse_generated_draft：当前源码/测试/脚本零匹配，剩余是历史记录和维护README历史范围说明。逐引用分类在references-before.tsv/after.tsv。一次源扩展搜索包含预先存在pytest nodeids缓存中的9个旧测试路径；修正选择排除工具缓存，不删除别人缓存、不将缓存当运行时实现。

## 差异、保护和清理

```bash
git diff --check
git status --short
git diff --name-only --cached
```

最终在证据/状态更新后执行，staged为空，无提交。对照初始快照确认本轮依赖/Makefile/OpenAPI/database.md/历史Alembic零变化；审查源码/测试/doc增量，无隐藏fallback、重复规则或范围外覆盖。

PG查询遗留业务测试库0，pg_ctl精确停止本轮data目录，65533释放。首次清理探针宿主Python缺psycopg，改用backend依赖环境完成，未操作业务库。fake HTTP由context关闭线程/端口，无Redis/浏览器/容器。系统临时快照、PGdata/log、收集日志/一次性diff在交付前删除；正式task证据、manifest、维护文档和审计Bundle保留。

## 独立复核、未执行与限制

Fresh critical_reviewer未确认阻断，14个SDK响应与8个Profile owner无落盘反例通过；内存收尾替身不替代PG。见review.md。Audit ID:20261013T124250Z-psr-004-remove-custom-http-79657bf5；Digest/audit-finalize/verify通过、closed。报告验收不替代用户人工接受。

无真实Provider/凭据、生产HTTPS、Linux镜像/部署验证；未执行完整make verify、全仓测试、Redis/Celery进程、完整Playwright/E2E/Browser矩阵。本切片通过SDK/localHTTP/PG与fresh入口装配直接验证，不新增完整用户流程或Broker行为。Collector接收后大小检查无法约束SDK完整读取期间内存，延续PSR-003合同；不新增网络替代组件。PSR-005/006未实施。


## 人工验收完成（2026-10-13）

用户明确确认：“我已经人工审查并接受 PSR-004。”据此将维护manifest的PSR-004从review更新为done；对应Trellis task从review更新为completed，记录completedAt=2026-10-13。

本轮只更新PSR-004状态和人工验收记录，复用已接受的实现、测试与独立复核证据；其他任务状态不变，不实施Browser或质量门禁后续任务，不提交、推送、归档或部署。

本轮残留搜索：
- `rg -n "PinnedHTTPTransport|PinnedTransportError|PinnedResponse|resolve_endpoint|connect_address|wrap_tls" .`：exit1，无匹配。
- `rg -n "OpenAICompatibleClient" backend tests docs deploy`：exit1，无匹配。
- `rg -n "import (socket|ssl|http\.client|ipaddress)" backend/app`：exit0，仅geo_fake_server的socket（本机fake断连）、geo_ops_health的socket.gethostname（节点身份）与geo_citation_urls的ipaddress（引用URL规范化）；无AI网络栈残留。
- 补充隐藏/ignored源搜索，排除依赖/工具缓存与引用清单自身：当前源码/测试/脚本零残留；匹配仅为1281处历史记录和1处维护README历史范围说明。后续验收记录自身增加历史匹配，不表示运行时实现恢复。

状态和记录更新后执行`git diff --check`：exit0，通过。本轮不重新运行实现测试或完整门禁。
