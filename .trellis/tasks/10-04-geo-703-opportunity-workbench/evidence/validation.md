# GEO-703 验证记录

每条命令的完整argv、exit_code、耗时与原始日志保存在同名JSON/log。最终门禁与后续局部修正按时间分别记录，不将较早成功冒充最新候选的全套重跑。

| 证据 | 精确命令 | exit |
|---|---|---:|
| [baseline-unit](baseline-unit.log) | `uv run --project backend pytest backend/tests/unit/test_geo_opportunity_policy.py backend/tests/unit/test_geo_opportunity_rules.py backend/tests/unit/test_geo_opportunity_baseline.py backend/tests/unit/test_contract.py` | 0 |
| [baseline-frontend](baseline-frontend.log) | `npm --prefix frontend run test -- src/domains/geo-rules src/domains/geo-runs src/app/navigation.test.ts` | 0 |
| [baseline-integration](baseline-integration.log) | `docker compose -f .trellis/tasks/10-04-geo-703-opportunity-workbench/evidence/compose.yaml run --rm backend-test pytest tests/integration/test_geo_opportunities.py tests/integration/test_geo_opportunity_baseline.py tests/integration/test_geo_opportunity_migration.py tests/integration/test_geo_opportunity_migration_stop.py` | 0 |
| [lint-audit-final](lint-audit-final.log) | `make lint` | 0 |
| [typecheck-audit-final](typecheck-audit-final.log) | `make typecheck` | 0 |
| [unit](unit.log) | `make test-unit` | 0 |
| [integration-final](integration-final.log) | `make test-integration COMPOSE=docker compose -f .trellis/tasks/10-04-geo-703-opportunity-workbench/evidence/compose.yaml` | 0 |
| [frontend-test-final](frontend-test-final.log) | `npm --prefix frontend run test` | 0 |
| [frontend-typecheck-final](frontend-typecheck-final.log) | `npm --prefix frontend run typecheck` | 0 |
| [contract-check-final](contract-check-final.log) | `make contract-check` | 0 |
| [geo703-read-security-final](geo703-read-security-final.log) | `docker compose -f .trellis/tasks/10-04-geo-703-opportunity-workbench/evidence/compose.yaml run --rm backend-test pytest tests/integration/test_geo_opportunity_workbench.py tests/integration/test_geo_read_consistency.py` | 0 |
| [audit-related-before](audit-related-before.log) | `docker compose -f .trellis/tasks/10-04-geo-703-opportunity-workbench/evidence/compose.yaml run --rm backend-test pytest tests/integration/test_geo_opportunity_workbench.py::test_acknowledge_dismiss_revision_and_atomic_safe_audit` | 1 |
| [audit-related-after](audit-related-after.log) | `docker compose -f .trellis/tasks/10-04-geo-703-opportunity-workbench/evidence/compose.yaml run --rm backend-test pytest tests/integration/test_geo_opportunity_workbench.py` | 0 |
| [audit-unit-after](audit-unit-after.log) | `backend/.venv/bin/python -m pytest backend/tests/unit/test_audit.py backend/tests/unit/test_configuration_audit.py` | 0 |
| [frontend-drawer-final](frontend-drawer-final.log) | `npm --prefix frontend run test -- src/domains/geo-opportunities/opportunities-page.test.tsx` | 0 |
| [e2e-opportunity-cancellation-final](e2e-opportunity-cancellation-final.log) | `env DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55473/partsignal REDIS_URL=redis://127.0.0.1:56473/14 SESSION_SECRET=geo703-fictional-session-secret-at-least-32-bytes OBJECT_STORAGE_BACKEND=development COOKIE_SECURE=false PARTSIGNAL_E2E_SPEC=tests/e2e/opportunities-real-stack.spec.ts deploy/scripts/e2e-local.sh` | 0 |

独占环境：Docker project geo703-validation，PG端口55473、Redis56473。集成Redis15，E2E Redis14；E2E每阶段独立owned随机数据库，结束清理。所有AI/对象存储来自既有fake/development适配器。

完整make e2e（e2e-full.json）exit0：canonical真实栈30通过；enabled/api-disabled/monitoring-disabled各1通过且各跳过1；frontend browser 498通过68跳过。所有阶段secret scan clean。最后Drawer定向视觉复验e2e-opportunity-layout-final exit0，桌面宽度>700px、opacity=1，全部旅程通过，secret scan clean且owned资源清理完成。

完整unit/integration的成功记录后，只补充了审计related target登记和Drawer样式：前者7PG+25审计单测复验，后者14组件测试+最终真实栈视觉复验。未将这些增量后的定向检查描述为重新执行全量unit/integration。

已经诊断并修复：旧contract/runtime固定计数、Run无答案时共享文件查询提前跳过造成15次固定查询回归、E2E优先级硬编码、正常AbortSignal GET被审计误判、新审计对象尚未登记。原失败日志保留。完整集成最终1046通过，31项为既有SQLAlchemy循环FK/dialect_options警告。

未执行生产迁移/发布、真实外部AI、Browser Adapter或生产对象存储测试：明确范围外，普通测试不使用真实平台。

最终lint-delivery-final exit0；git diff --check记录diff-check-final；独占Docker project测试完后关闭并移除私有测试卷。
