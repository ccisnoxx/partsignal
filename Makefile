SHELL := /bin/sh
COMPOSE := docker compose --env-file .env -f deploy/compose.dev.yaml
UV_CACHE_DIR ?= $(CURDIR)/.cache/uv
UV := UV_CACHE_DIR=$(UV_CACHE_DIR) uv

.PHONY: bootstrap contract-generate contract-check dev dev-infra migrate initialize-accounts lint typecheck test-unit test-integration e2e build build-frontend verify test-deploy-scripts test-frontend-container staging-redeploy-fast down test-geo-fixtures test-geo-collector-contract test-geo-performance test-geo-browser test-geo-browser-contract test-geo-recovery test-geo-recovery-integration test-geo-capacity test-upgrade-recovery test-upgrade-recovery-compose

bootstrap:
	@test -f .env || cp .env.example .env
	$(UV) sync --project backend --all-extras
	npm --prefix frontend ci
	npm --prefix browser-collector ci

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
	npm --prefix browser-collector run lint
	$(UV) run --project backend ruff check backend
	npm --prefix frontend run lint

typecheck:
	npm --prefix browser-collector run typecheck
	$(UV) run --project backend mypy --config-file backend/pyproject.toml backend/app
	npm --prefix frontend run typecheck

test-unit:
	npm --prefix browser-collector test
	$(UV) run --project backend pytest backend/tests/unit
	npm --prefix frontend run test

test-integration:
	# 恢复用例需要回环连接和显式 PG16 工具，在下一条必跑命令中执行。
	$(COMPOSE) run --rm backend-test pytest tests/integration --ignore=tests/integration/test_geo_recovery.py
	$(MAKE) test-geo-recovery-integration

test-geo-recovery-integration:
	$(COMPOSE) up -d --wait postgres redis
	$(UV) run --project backend python deploy/scripts/test-geo-recovery-integration.py

e2e: test-geo-browser-contract
	PARTSIGNAL_E2E_GEO_MODE= PARTSIGNAL_E2E_SPEC= deploy/scripts/e2e-local.sh
	PARTSIGNAL_E2E_SPEC= deploy/scripts/e2e-geo.sh
	npm --prefix frontend run e2e

build: build-frontend
	docker build -f backend/Dockerfile -t partsignal-backend:test backend

build-frontend:
	docker build -f frontend/Dockerfile -t partsignal-frontend-v2:test frontend

verify: contract-check lint typecheck test-unit test-integration test-geo-performance build e2e test-deploy-scripts
	$(COMPOSE) config --quiet
	PARTSIGNAL_BACKEND_IMAGE=partsignal-backend PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 PARTSIGNAL_VERSION=test PARTSIGNAL_RUNTIME_ENV_FILE=$(CURDIR)/.env PARTSIGNAL_DATA_ROOT=$(CURDIR)/data docker compose --env-file .env -f deploy/compose.prod.yaml config --quiet

test-geo-fixtures:
	$(UV) run --project backend python deploy/scripts/check-geo-fixtures.py

test-geo-collector-contract:
	$(UV) run --project backend python deploy/scripts/test-geo-collector-contract.py

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
	$(UV) run --project backend python deploy/scripts/test-geo-browser.py
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

down:
	$(COMPOSE) down --remove-orphans
