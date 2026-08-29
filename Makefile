SHELL := /bin/sh
COMPOSE := docker compose --env-file .env -f deploy/compose.dev.yaml
UV_CACHE_DIR ?= $(CURDIR)/.cache/uv
UV := UV_CACHE_DIR=$(UV_CACHE_DIR) uv

.PHONY: bootstrap contract-generate contract-check dev dev-infra migrate initialize-accounts lint typecheck test-unit test-integration e2e build build-frontend verify test-deploy-scripts test-frontend-container staging-redeploy-fast down

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

test-integration:
	$(COMPOSE) run --rm backend-test

e2e:
	deploy/scripts/e2e-local.sh
	npm --prefix frontend run e2e

build:
	docker build -f backend/Dockerfile -t partsignal-backend:test backend
	$(MAKE) build-frontend

build-frontend:
	docker build -f frontend/Dockerfile -t partsignal-frontend-v2:test frontend

verify: contract-check lint typecheck test-unit test-integration build e2e test-deploy-scripts
	$(COMPOSE) config --quiet
	PARTSIGNAL_BACKEND_IMAGE=partsignal-backend PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 PARTSIGNAL_VERSION=test PARTSIGNAL_RUNTIME_ENV_FILE=$(CURDIR)/.env PARTSIGNAL_DATA_ROOT=$(CURDIR)/data docker compose --env-file .env -f deploy/compose.prod.yaml config --quiet

test-deploy-scripts: test-frontend-container
	deploy/scripts/test-deploy-staging.sh
	deploy/scripts/test-deploy-production.sh

test-frontend-container: build-frontend
	deploy/scripts/test-frontend-container.sh

staging-redeploy-fast:
	deploy/scripts/redeploy-staging-fast.sh

down:
	$(COMPOSE) down --remove-orphans
