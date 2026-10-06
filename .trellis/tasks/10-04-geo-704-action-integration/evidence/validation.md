# GEO-704 实际验证

所有命令均有精确argv、exit、耗时和原始日志；下表只使用已结束的记录。

| 检查 | 精确命令 | exit | 结果 |
|---|---|---:|---|
| baseline-unit | `uv run --project backend pytest backend/tests/unit/test_geo_opportunity_policy.py backend/tests/unit/test_geo_opportunity_workbench.py backend/tests/unit/test_runtime_response_metadata.py -q` | 0 | 389相关unit通过 |
| baseline-integration | `docker compose -f .trellis/tasks/10-04-geo-704-action-integration/evidence/compose.yaml run --rm backend-test pytest -o addopts= -q tests/integration/test_geo_opportunity_workbench.py tests/integration/test_geo_opportunities.py` | 0 | 18 PG通过，2 metadata warning |
| gate-diff-check-final | `git diff --check` | 0 | 通过 |
| gate-lint-final | `make lint` | 0 | 通过 |
| gate-typecheck-final | `make typecheck` | 0 | backend219源码+frontend通过 |
| gate-unit-fixed | `make test-unit` | 0 | 3649 backend / 1244 frontend通过 |
| gate-integration-isolated-final | `make test-integration 'COMPOSE=docker compose -f .trellis/tasks/10-04-geo-704-action-integration/evidence/compose.yaml'` | 0 | 1062 passed / 31 metadata warnings |
| gate-contract | `make contract-check` | 0 | 根/runtime/generated一致 |
| targeted-actions-final | `docker compose -f .trellis/tasks/10-04-geo-704-action-integration/evidence/compose.yaml run --rm backend-test pytest -o addopts= -q tests/integration/test_geo_opportunity_actions.py tests/integration/test_geo_opportunity_action_guards.py tests/integration/test_geo_opportunity_action_migration.py` | 0 | 16 PG通过 |
| e2e-actions | `env DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55474/partsignal REDIS_URL=redis://127.0.0.1:56474/14 SESSION_SECRET=geo704-fictional-session-secret-at-least-32-bytes OBJECT_STORAGE_BACKEND=development COOKIE_SECURE=false PARTSIGNAL_E2E_SPEC=tests/e2e/opportunities-real-stack.spec.ts deploy/scripts/e2e-local.sh` | 0 | 1目标真实栈通过，清理/secret scan clean |
| gate-e2e | `env DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55474/partsignal REDIS_URL=redis://127.0.0.1:56474/14 SESSION_SECRET=geo704-fictional-session-secret-at-least-32-bytes OBJECT_STORAGE_BACKEND=development COOKIE_SECURE=false make e2e` | 0 | 30 canonical+3 GEO+498 fixture通过；3 GEO及68 fixture按阶段skip，全部secret scan clean |
| validation-cleanup | `docker compose -f .trellis/tasks/10-04-geo-704-action-integration/evidence/compose.yaml down --volumes` | 0 | 独占容器/网络/测试卷清理成功 |

首轮失败及处理：

- gate-lint：两条lint规则；gate-unit：三处合同计数/签名/投影fixture不一致和未改fake provider 1秒并发用例的高负载超时。修正合同/fixture，减少同时验证负载后完整unit通过；不放宽超时。
- gate-integration：1056 passed/4 failed，旧0059 head/降级断言与fixture revision已改为真实0060/current revision；修正后完整隔离gate-integration-isolated-final通过。
- gate-integration-final：COMPOSE_FILE环境变量未覆盖Makefile显式-f，已停止仅该次新测试容器；exit2，不计通过。正确命令使用make COMPOSE=独占Compose。
- 初期targeted-actions/guards失败是fixture、UUID/varchar比较及复核暴露的合同问题，修正后最终16 PG通过；原始日志均保留。

未运行及既有差异：

- 真实外部AI、Browser、生产保留/生产迁移/发布与705及以后能力均范围外。未运行make verify中无关性能/部署目标；不冒充完整发布验收。
- E2E stage skip：GEO三阶段各非匹配case skip；fixture阶段68个真实栈case受专用环境守卫skip，适用的真实旅程在前序canonical/GEO阶段执行。skip不计passed。
- 新0060相关ORM compare_metadata通过；31条既有类别SAWarning为循环FK拓扑和dialect_options，原日志保留。
- 文档包整体shasum -a 256 -c SHA256SUMS有README与核心PRD两项既有指纹不匹配，正文与起始hash一致；704相关5项指纹已更新，见document-checksums.json。

独立复核：Audit Bundle校验通过，候选的两项P2已修复并用真实PG反例验证；没有声称修复后的再次独立批准。见review.md和SUBAGENT_EXECUTION_DIGEST.md。
