SHELL := /bin/sh
COMPOSE := docker compose --env-file .env -f deploy/compose.dev.yaml
UV_CACHE_DIR ?= $(CURDIR)/.cache/uv
UV := UV_CACHE_DIR=$(UV_CACHE_DIR) uv

# 开发者手工选择领域；本机集成使用显式测试 PostgreSQL 和 HTTP fake provider。
AI_UNIT_TESTS := backend/tests/unit/test_ai_provider.py backend/tests/unit/test_ai_boundaries.py \
	$(wildcard backend/tests/unit/test_generation*.py)
AI_INTEGRATION_TESTS := backend/tests/integration/test_ai_channel_management.py \
	backend/tests/integration/test_ai_provider_configuration.py \
	backend/tests/integration/test_generation_provider.py
AI_FRONTEND_TESTS := $(patsubst frontend/%,%,$(wildcard frontend/src/domains/configuration/ai-*.test.*) \
	$(wildcard frontend/src/domains/configuration/prompt-*.test.*) \
	frontend/src/domains/content/content-ai-production.test.tsx)
# Collector 的五个 HTTP 套件由 test-geo-collector-contract 拥有，避免重复执行。
GEO_UNIT_TESTS := $(filter-out backend/tests/unit/test_geo_browser_%.py \
	backend/tests/unit/test_geo_recovery_%.py backend/tests/unit/test_geo_performance_contracts.py \
	backend/tests/unit/test_geo_fake_provider.py backend/tests/unit/test_geo_collector_suite.py \
	backend/tests/unit/test_geo_openai_collector.py backend/tests/unit/test_geo_openai_response.py \
	backend/tests/unit/test_geo_openai_network.py,$(wildcard backend/tests/unit/test_geo_*.py))
GEO_INTEGRATION_TESTS := backend/tests/integration/test_geo_sdk_collection.py \
	backend/tests/integration/test_geo_profile_tests.py \
	backend/tests/integration/test_geo_profile_test_races.py \
	backend/tests/integration/test_geo_security_review.py \
	backend/tests/integration/test_geo_at_most_once.py \
	backend/tests/integration/test_geo_manual_collection.py \
	backend/tests/integration/test_geo_manual_collection_boundaries.py \
	backend/tests/integration/test_geo_manual_races.py \
	backend/tests/integration/test_geo_analysis.py

.PHONY: bootstrap contract-generate contract-check dev dev-infra migrate initialize-accounts lint typecheck test-unit test-integration e2e build build-frontend verify verify-release check-backend-fast check-frontend-fast check-fast check-ai check-geo test-deploy-scripts test-frontend-container staging-redeploy-fast down test-geo-fixtures test-geo-collector-contract test-geo-performance check-browser-experimental test-geo-browser test-geo-browser-contract test-geo-recovery test-geo-recovery-integration test-geo-capacity test-upgrade-recovery test-upgrade-recovery-compose production-check production-prepare production-activate production-smoke production-restart test-production-routine

bootstrap:
	@test -f .env || cp .env.example .env
	$(UV) sync --project backend --all-extras
	npm --prefix frontend ci

contract-generate:
	npm --prefix frontend run api:generate

contract-check:
	$(UV) run --project backend python -m app.tools.contract_check contracts/openapi.yaml
	npm --prefix frontend run api:check

dev:
	@test -f .env || cp .env.example .env
	$(COMPOSE) up --build -d postgres redis
	$(COMPOSE) run --rm migrate
	$(COMPOSE) up --build api worker scheduler fake-oss frontend

dev-infra:
	@test -f .env || cp .env.example .env
	$(COMPOSE) up -d postgres redis fake-oss

migrate:
	$(COMPOSE) run --rm migrate

initialize-accounts:
	$(COMPOSE) run --rm api python -m app.cli initialize-accounts

lint:
	$(UV) run --project backend ruff check backend
	npm --prefix frontend run lint

typecheck:
	$(UV) run --project backend mypy --config-file backend/pyproject.toml backend/app
	npm --prefix frontend run typecheck

test-unit:
	$(UV) run --project backend pytest backend/tests/unit
	npm --prefix frontend run test

check-backend-fast:
	$(UV) run --project backend ruff check backend
	$(UV) run --project backend mypy --config-file backend/pyproject.toml backend/app
	$(UV) run --project backend pytest backend/tests/unit

check-frontend-fast:
	npm --prefix frontend run lint
	npm --prefix frontend run typecheck
	npm --prefix frontend run test

check-fast: check-backend-fast check-frontend-fast

check-ai:
	@test -n "$$PARTSIGNAL_TEST_DATABASE_URL" || { echo 'check-ai 需要显式设置 PARTSIGNAL_TEST_DATABASE_URL（专用测试 PostgreSQL）' >&2; exit 2; }
	$(UV) run --project backend pytest $(AI_UNIT_TESTS)
	$(UV) run --project backend pytest $(AI_INTEGRATION_TESTS)
	npm --prefix frontend run test -- $(AI_FRONTEND_TESTS)

check-geo: test-geo-fixtures test-geo-collector-contract
	@test -n "$$PARTSIGNAL_TEST_DATABASE_URL" || { echo 'check-geo 需要显式设置 PARTSIGNAL_TEST_DATABASE_URL（专用测试 PostgreSQL）' >&2; exit 2; }
	@test -n "$$OBJECT_STORAGE_ENDPOINT" || { echo 'check-geo 需要显式设置 OBJECT_STORAGE_ENDPOINT（已启动的本地开发对象存储）' >&2; exit 2; }
	$(UV) run --project backend pytest $(GEO_UNIT_TESTS)
	PGTZ=UTC OBJECT_STORAGE_BACKEND=development $(UV) run --project backend pytest $(GEO_INTEGRATION_TESTS)
	npm --prefix frontend run test -- src/domains/geo- src/domains/geo/

test-integration:
	# 恢复用例需要回环连接和显式 PG16 工具，在下一条必跑命令中执行。
	$(COMPOSE) run --rm backend-test pytest tests/integration --ignore=tests/integration/test_geo_recovery.py
	$(MAKE) test-geo-recovery-integration

test-geo-recovery-integration:
	$(COMPOSE) up -d --wait postgres redis
	$(UV) run --project backend python deploy/scripts/test-geo-recovery-integration.py

e2e:
	PARTSIGNAL_E2E_GEO_MODE= PARTSIGNAL_E2E_SPEC= deploy/scripts/e2e-local.sh
	PARTSIGNAL_E2E_SPEC= deploy/scripts/e2e-geo.sh
	npm --prefix frontend run e2e

build: build-frontend
	docker build -f backend/Dockerfile -t partsignal-backend:test backend

build-frontend:
	docker build -f frontend/Dockerfile -t partsignal-frontend-v2:test frontend

# 旧入口直接委托完整发布验证，保持已有脚本和使用习惯。
verify: verify-release

verify-release: contract-check lint typecheck test-unit test-integration test-geo-performance build e2e test-deploy-scripts
	$(COMPOSE) config --quiet
	PARTSIGNAL_BACKEND_IMAGE=partsignal-backend PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 PARTSIGNAL_VERSION=test PARTSIGNAL_RUNTIME_ENV_FILE=$(CURDIR)/.env PARTSIGNAL_DATA_ROOT=$(CURDIR)/data docker compose --env-file .env -f deploy/compose.prod.yaml config --quiet

test-geo-fixtures:
	$(UV) run --project backend python deploy/scripts/check-geo-fixtures.py

test-geo-collector-contract:
	$(UV) run --project backend python deploy/scripts/test-geo-collector-contract.py

# 后续能力的显式实验检查，不被默认开发、验证或部署目标依赖。
check-browser-experimental:
	npm --prefix browser-collector ci
	npm --prefix browser-collector run lint
	npm --prefix browser-collector run typecheck
	npm --prefix browser-collector test
	$(UV) run --project backend python deploy/scripts/test-geo-browser.py
	$(MAKE) test-geo-browser-contract

test-geo-browser:
	$(UV) run --project backend python deploy/scripts/test-geo-browser.py --runtime

test-geo-browser-contract:
	$(UV) run --project backend python deploy/scripts/test-geo-browser-contract.py $(if $(filter 1,$(GEO_BROWSER_CONTRACT_CONTAINER)),--container,)

test-geo-capacity:
	$(COMPOSE) run --rm -e GEO_PERF_PHASE=candidate -e GEO_CAPACITY_PHASE=candidate -e GEO_CAPACITY_OUTPUT=/app/tests/performance/.results/geo905/candidate backend-test pytest -s tests/performance/test_geo_capacity.py tests/performance/test_geo_worker_capacity.py

test-geo-performance:
	$(COMPOSE) run --rm -e GEO_PERF_PHASE=candidate -e GEO_PERF_OUTPUT=/app/tests/performance/.results/candidate backend-test pytest -s tests/performance/test_geo_insight_performance.py

test-geo-recovery:
	$(UV) run --project backend pytest backend/tests/unit/test_geo_recovery_boundaries.py
	$(UV) run --project backend ruff check deploy/scripts/geo-recovery.py deploy/scripts/geo_recovery_bundle.py deploy/scripts/geo_recovery_environment.py deploy/scripts/test-geo-recovery-integration.py

test-upgrade-recovery:
	python3 deploy/scripts/test-upgrade-recovery.py
	python3 deploy/scripts/test-upgrade-failure.py
	python3 deploy/scripts/test-upgrade-runtime-policy.py
	python3 deploy/scripts/test-migration-runtime.py
	python3 deploy/scripts/test-upgrade-cache-policy.py
	python3 deploy/scripts/test-upgrade-registry-order.py
	python3 deploy/scripts/test-upgrade-signal.py

# 需本地固定 Production project/network 空闲；不接管任何既有资源。
test-upgrade-recovery-compose:
	python3 deploy/scripts/test-upgrade-recovery-compose.py
	python3 deploy/scripts/test-upgrade-image-cache.py

test-deploy-scripts: test-frontend-container test-geo-recovery
	$(UV) run --project backend python deploy/scripts/test-geo-collector-contract.py
	$(UV) run --project backend python deploy/scripts/check-geo-fixtures.py
	$(UV) run --project backend python deploy/scripts/test-geo-configuration.py
	deploy/scripts/test-e2e-run-lifecycle.sh
	deploy/scripts/test-e2e-database-lifecycle.sh
	frontend/tests/helpers/test-secret-artifact-post-run.sh
	deploy/scripts/test-deploy-staging.sh
	deploy/scripts/test-deploy-production-cleanup.sh
	deploy/scripts/test-deploy-production.sh
	$(MAKE) test-upgrade-recovery

test-frontend-container: build-frontend
	deploy/scripts/test-frontend-container.sh

staging-redeploy-fast:
	deploy/scripts/redeploy-staging-fast.sh

# Host 只消费已冻结 archive/images/manifest；不安装依赖或触发源码完整验证。
# 参数示例：PRODUCTION_ARGS='--public-url https://geo.962850.xyz'。
production-check production-prepare production-activate production-smoke production-restart:
	deploy/scripts/redeploy-production.sh $(patsubst production-%,%,$@) $(PRODUCTION_ARGS)

test-production-routine:
	python3 deploy/scripts/test-production-routine.py
	python3 deploy/scripts/test-production-ai-handoff.py
	python3 deploy/scripts/test-upgrade-runtime-policy.py
	python3 deploy/scripts/test-upgrade-registry-order.py

down:
	$(COMPOSE) down --remove-orphans
